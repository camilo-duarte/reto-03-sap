import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validarSolicitudConReglas, oc_crear } from './tools/oc.js';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../web')));

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente');
});

app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, confirmadoPorUsuario } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    const matchSolicitud = message.match(/sol-\d{3}/i);
    let resultadoValidacion: any = null;
    let resultadoCreacion: any = null;
    let contextoTecnico = '';

    if (matchSolicitud) {
      const solicitudId = matchSolicitud[0].toLowerCase();
      resultadoValidacion = validarSolicitudConReglas(solicitudId, confirmadoPorUsuario || false);

      if (message.toLowerCase().includes('procesar') || message.toLowerCase().includes('crear') || confirmadoPorUsuario) {
        resultadoCreacion = oc_crear(solicitudId, true);
        contextoTecnico = `\n[DATOS TÉCNICOS SAP - ORDEN CREADA/EVALUADA]:\n${JSON.stringify(resultadoCreacion, null, 2)}`;
      } else {
        contextoTecnico = `\n[DATOS TÉCNICOS SAP - VALIDACIÓN REGLAS RC1-RC10]:\n${JSON.stringify(resultadoValidacion, null, 2)}`;
      }
    }

    let responseText = '';
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY;

    // Intentar usar LLM (Anthropic o Gemini según la llave configurada)
    try {
      if (!apiKey) {
        throw new Error('No hay API key configurada, usando respaldo directo.');
      }

      // Si la llave empieza con sk-ant, usamos Anthropic Claude
      if (apiKey.startsWith('sk-ant')) {
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            system: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. Redacta una respuesta profesional, clara y ejecutiva en español basándote estrictamente en la información técnica proporcionada.\n${contextoTecnico}`,
            messages: [{ role: 'user', content: message }],
          }),
        });

        const data = await anthropicResponse.json();
        if (!anthropicResponse.ok) throw new Error(data.error?.message || 'Error en Anthropic');
        responseText = data.content?.[0]?.text || '';
      } else {
        // De lo contrario, intentamos usar Google Gemini
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{
                text: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. Redacta una respuesta profesional, clara y ejecutiva en español.\n\nConsulta: "${message}"\n${contextoTecnico}`
              }]
            }]
          }),
        });

        const data = await geminiResponse.json();
        if (!geminiResponse.ok) throw new Error(data.error?.message || 'Error en Gemini');
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (!responseText) throw new Error('Respuesta vacía del LLM');

    } catch (apiError: any) {
      // Fallback limpio y directo sin mencionar prefijos extraños
      if (resultadoCreacion) {
        if (resultadoCreacion.success) {
          responseText = `La solicitud **${matchSolicitud?.[0]?.toUpperCase()}** ha sido aprobada y procesada exitosamente. Se ha generado la Orden de Compra en SAP: **#${resultadoCreacion.ordenCompra}**`;
        } else {
          responseText = `La solicitud no pudo ser procesada. ${resultadoCreacion.mensaje}`;
        }
      } else if (resultadoValidacion) {
        if (resultadoValidacion.apta) {
          responseText = `La solicitud **${matchSolicitud?.[0]?.toUpperCase()}** cumple con todos los controles internos (RC1-RC10) y se encuentra apta para proceder con la creación de la Orden de Compra.`;
        } else {
          let detalleBloqueos = resultadoValidacion.bloqueos.length > 0 ? `\n- Bloqueos:\n  * ${resultadoValidacion.bloqueos.join('\n  * ')}` : '';
          let detalleAlertas = resultadoValidacion.confirmacionesRequeridas.length > 0 ? `\n- Alertas HITL (Requieren confirmación):\n  * ${resultadoValidacion.confirmacionesRequeridas.join('\n  * ')}` : '';
          responseText = `Se han evaluado los controles para la solicitud **${matchSolicitud?.[0]?.toUpperCase()}**:${detalleBloqueos}${detalleAlertas}`;
        }
      } else {
        responseText = `Hola. Soy el Agente SAP de Periferia IT Group. Por favor, indícame el número de solicitud que deseas consultar o procesar (ej: sol-001).`;
      }
    }

    res.json({ success: true, response: responseText });
  } catch (error: any) {
    console.error('Error crítico en /api/chat:', error);
    res.status(500).json({
      error: 'Error interno en el servidor',
      details: error?.message || String(error),
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
