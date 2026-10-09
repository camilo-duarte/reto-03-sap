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
  res.send('Servidor corriendo correctamente con Gemini API');
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
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      res.status(500).json({ error: 'La variable de entorno GEMINI_API_KEY no está configurada en el servidor.' });
      return;
    }

    // Llamada a la API de Gemini usando fetch nativo con el modelo gemini-1.5-flash o gemini-2.5-flash
    try {
      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP para Periferia IT Group. 
Interpreta las consultas del usuario, analiza los datos técnicos de cumplimiento normativo (RC1-RC10) y redacta una respuesta profesional y ejecutiva en español.\n\nConsulta del usuario: "${message}"\n${contextoTecnico}`
                }
              ]
            }
          ]
        }),
      });

      const data = await geminiResponse.json();

      if (!geminiResponse.ok) {
        throw new Error(data.error?.message || 'Error en la respuesta de la API de Gemini');
      }

      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Operación procesada con éxito.';
    } catch (apiError: any) {
      console.warn('[WARN] Error al consultar la API de Gemini. Activando fallback determinista local:', apiError.message);
      
      // Fallback seguro ante fallos del LLM o cuotas excedidas
      if (resultadoCreacion) {
        responseText = `[Modo Asistente SAP Directo]: La operación se ha procesado de forma determinista.\n- Estado: ${resultadoCreacion.success ? 'ÉXITO' : 'BLOQUEADO'}\n- Mensaje: ${resultadoCreacion.mensaje}\n- Orden SAP: ${resultadoCreacion.ordenCompra || 'N/A'}`;
      } else if (resultadoValidacion) {
        responseText = `[Modo Asistente SAP Directo]: Validación de controles para la solicitud:\n- Apta: ${resultadoValidacion.apta}\n- Bloqueos: ${resultadoValidacion.bloqueos.length > 0 ? resultadoValidacion.bloqueos.join(' | ') : 'Ninguno'}\n- Alertas HITL: ${resultadoValidacion.confirmacionesRequeridas.length > 0 ? resultadoValidacion.confirmacionesRequeridas.join(' | ') : 'Ninguna'}`;
      } else {
        responseText = `Hola. Soy el Agente SAP de Periferia IT Group. He recibido tu mensaje. Por favor, indica un número de solicitud válido (ej: sol-001 a sol-006).`;
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
