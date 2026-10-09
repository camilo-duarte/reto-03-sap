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

    try {
      if (!apiKey) {
        throw new Error('No hay API key configurada, usando respaldo directo.');
      }

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
            system: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. Responde de forma natural, fluida y profesional a cualquier pregunta del usuario (como listar solicitudes, explicar reglas, o saludar), integrando los datos técnicos de SAP solo cuando sea necesario.\n${contextoTecnico}`,
            messages: [{ role: 'user', content: message }],
          }),
        });

        const data = await anthropicResponse.json();
        if (!anthropicResponse.ok) throw new Error(data.error?.message || 'Error en Anthropic');
        responseText = data.content?.[0]?.text || '';
      } else {
        // Usamos el modelo correcto gemini-3.8-flash
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{
                text: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. Responde de manera natural, conversacional y profesional a cualquier consulta del usuario (saludos, preguntas generales, listado de solicitudes, o validaciones). Si te preguntan qué solicitudes hay, puedes mencionar que manejas las solicitudes desde sol-001 hasta sol-006.\n\nConsulta del usuario: "${message}"\n${contextoTecnico}`
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
      console.warn('[WARN] Error al consultar el LLM, usando respaldo:', apiError.message);
      
      // Respaldo por si falla la red
      if (resultadoCreacion) {
        responseText = resultadoCreacion.success 
          ? `La solicitud ${matchSolicitud?.[0]?.toUpperCase()} ha sido procesada exitosamente. Orden de Compra generada en SAP: #${resultadoCreacion.ordenCompra}`
          : `La solicitud no pudo procesarse: ${resultadoCreacion.mensaje}`;
      } else if (resultadoValidacion) {
        responseText = resultadoValidacion.apta 
          ? `La solicitud ${matchSolicitud?.[0]?.toUpperCase()} es totalmente apta para crear su orden de compra.`
          : `La solicitud ${matchSolicitud?.[0]?.toUpperCase()} presenta observaciones de control interno.`;
      } else {
        responseText = `¡Hola! Soy tu asistente experto en órdenes de compra SAP para Periferia IT Group. Puedo ayudarte a consultar, validar y procesar solicitudes (desde sol-001 hasta sol-006). ¿En qué te puedo colaborar hoy?`;
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
