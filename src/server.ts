import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { validarSolicitudConReglas, oc_crear } from './tools/oc.js';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../web')));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
});

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente');
});

// Función auxiliar para reintentar llamadas a la API en caso de error 503
async function generateContentWithRetry(aiClient: any, payload: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await aiClient.models.generateContent(payload);
    } catch (error: any) {
      const isUnavailable = error?.status === 503 || error?.message?.includes('503') || error?.message?.includes('high demand');
      if (isUnavailable && attempt < maxRetries) {
        const delay = attempt * 2000; // Espera progresiva: 2s, 4s, 6s...
        console.warn(`[WARN] Modelo saturado (503). Reintentando en ${delay / 1000}s (Intento ${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, confirmadoPorUsuario } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    // Detectar si el mensaje menciona alguna solicitud específica (ej: sol-001, sol-004, etc.)
    const matchSolicitud = message.match(/sol-\d{3}/i);
    let datosTool = '';
    let resultadoValidacionGlobal: any = null;

    if (matchSolicitud) {
      const solicitudId = matchSolicitud[0].toLowerCase();
      resultadoValidacionGlobal = validarSolicitudConReglas(solicitudId, confirmadoPorUsuario || false);
      
      if (message.toLowerCase().includes('procesar') || message.toLowerCase().includes('crear')) {
        const resultadoCreacion = oc_crear(solicitudId, confirmadoPorUsuario || false);
        datosTool = `\n\n[EJECUCIÓN DE HERRAMIENTA OC]:\n${JSON.stringify(resultadoCreacion, null, 2)}`;
      } else {
        datosTool = `\n\n[VALIDACIÓN DE REGLAS RC1-RC10]:\n${JSON.stringify(resultadoValidacionGlobal, null, 2)}`;
      }
    }

    const systemPrompt = `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP (Periferia IT Group). 
Utiliza estrictamente los resultados de validación técnica adjuntos para responder al usuario de forma precisa y profesional.${datosTool}`;

    let responseText = '';

    try {
      const response = await generateContentWithRetry(ai, {
        model: 'gemini-3.8-flash',
        contents: message,
        config: {
          systemInstruction: systemPrompt,
        },
      });
      responseText = response.text || 'Procesamiento completado.';
    } catch (aiError: any) {
      console.error('Error persistente con la IA, aplicando fallback determinista:', aiError);
      // Fallback de emergencia si la API de Google sigue caída: respondemos directo con la lógica del negocio
      if (resultadoValidacionGlobal) {
        responseText = `[Aviso de sistema por alta demanda en IA]: La validación técnica de la solicitud se ejecutó de forma determinista:\n- Apta: ${resultadoValidacionGlobal.apta}\n- Bloqueos: ${JSON.stringify(resultadoValidacionGlobal.bloqueos)}\n- Alertas HITL: ${JSON.stringify(resultadoValidacionGlobal.confirmacionesRequeridas)}`;
      } else {
        responseText = 'El servicio de IA está experimentando alta demanda temporal (Error 503). Por favor, intenta de nuevo en unos segundos.';
      }
    }

    res.json({ success: true, response: responseText });
  } catch (error: any) {
    console.error('Error en /api/chat:', error);
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
