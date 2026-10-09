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
    const apiKey = process.env.API_KEY || process.env.GROQ_API_KEY;

    try {
      if (!apiKey) {
        throw new Error('No hay API key configurada.');
      }

      // Petición oficial a OpenRouter usando el endpoint compatible con OpenAI
      const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://periferia.it', // Requerido/Recomendado por OpenRouter
          'X-Title': 'SAP Procurement Agent'         // Nombre de la app para OpenRouter
        },
        body: JSON.stringify({
          model: 'deepseek/deepseek-chat:free', // Modelo gratuito altamente estable en OpenRouter
          messages: [
            {
              role: 'system',
              content: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. Responde de manera natural, conversacional y profesional en español a cualquier consulta del usuario. Si preguntan por solicitudes, manejas desde sol-001 hasta sol-006.\n${contextoTecnico}`
            },
            {
              role: 'user',
              content: message
            }
          ],
          temperature: 0.3
        })
      });

      const data = await aiResponse.json();

      if (!aiResponse.ok) {
        throw new Error(data.error?.message || `Error HTTP ${aiResponse.status}`);
      }

      responseText = data.choices?.[0]?.message?.content || '';
      if (!responseText) throw new Error('Respuesta vacía del LLM');

    } catch (apiError: any) {
      console.warn('[WARN] Usando respaldo determinista local debido a:', apiError.message);
      
      // Respaldo robusto de alta disponibilidad
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
