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

    if (matchSolicitud) {
      const solicitudId = matchSolicitud[0].toLowerCase();
      const resultadoValidacion = validarSolicitudConReglas(solicitudId, confirmadoPorUsuario || false);
      
      if (message.toLowerCase().includes('procesar') || message.toLowerCase().includes('crear')) {
        const resultadoCreacion = oc_crear(solicitudId, confirmadoPorUsuario || false);
        datosTool = `\n\n[EJECUCIÓN DE HERRAMIENTA OC]:\n${JSON.stringify(resultadoCreacion, null, 2)}`;
      } else {
        datosTool = `\n\n[VALIDACIÓN DE REGLAS RC1-RC10]:\n${JSON.stringify(resultadoValidacion, null, 2)}`;
      }
    }

    const systemPrompt = `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP (Periferia IT Group). 
Utiliza estrictamente los resultados de validación técnica adjuntos para responder al usuario de forma precisa y profesional.${datosTool}`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash', // Modelo con alta disponibilidad y cuota estable
      contents: message,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    res.json({ success: true, response: response.text || 'Sin respuesta del modelo.' });
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
