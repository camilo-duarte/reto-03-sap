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

    // 1. Detección automática de la solicitud en el mensaje (ej: sol-001, sol-004...)
    const matchSolicitud = message.match(/sol-\d{3}/i);
    let resultadoValidacion: any = null;
    let resultadoCreacion: any = null;
    let contextoTecnico = '';

    if (matchSolicitud) {
      const solicitudId = matchSolicitud[0].toLowerCase();
      resultadoValidacion = validarSolicitudConReglas(solicitudId, confirmadoPorUsuario || false);

      if (message.toLowerCase().includes('procesar') || message.toLowerCase().includes('crear') || confirmadoPorUsuario) {
        resultadoCreacion = oc_crear(solicitudId, true);
        contextoTecnico = `\n[EJECUCIÓN DE ORDEN SAP]:\n${JSON.stringify(resultadoCreacion, null, 2)}`;
      } else {
        contextoTecnico = `\n[VALIDACIÓN TÉCNICA REGLAS RC1-RC10]:\n${JSON.stringify(resultadoValidacion, null, 2)}`;
      }
    }

    let responseText = '';

    // 2. Intentar procesar con Gemini de forma fluida
    try {
      const systemPrompt = `Eres el Agente Conversacional experto en Control y Órdenes de Compra SAP (Periferia IT Group). 
Utiliza estrictamente los datos técnicos adjuntos para responder de forma profesional.${contextoTecnico}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: message,
        config: {
          systemInstruction: systemPrompt,
        },
      });
      responseText = response.text || 'Operación procesada con éxito.';
    } catch (aiError) {
      // 3. FALLBACK INTELIGENTE (Si la IA falla por 503 o cuota, responde la lógica local directamente)
      console.warn('[WARN] API de IA saturada o sin cuota. Activando respuesta determinista local.');
      
      if (resultadoCreacion) {
        responseText = `[Modo Asistente SAP Directo]: La operación sobre la solicitud se ha procesado de forma determinista.\n- Estado: ${resultadoCreacion.success ? 'ÉXITO' : 'BLOQUEADO'}\n- Mensaje: ${resultadoCreacion.mensaje}\n- Orden SAP: ${resultadoCreacion.ordenCompra || 'N/A'}`;
      } else if (resultadoValidacion) {
        responseText = `[Modo Asistente SAP Directo]: Validación de controles para la solicitud:\n- Apta para procesar: ${resultadoValidacion.apta}\n- Bloqueos internos: ${resultadoValidacion.bloqueos.length > 0 ? resultadoValidacion.bloqueos.join(' | ') : 'Ninguno'}\n- Alertas HITL: ${resultadoValidacion.confirmacionesRequeridas.length > 0 ? resultadoValidacion.confirmacionesRequeridas.join(' | ') : 'Ninguna'}`;
      } else {
        responseText = `Hola. Soy el Agente SAP de Periferia IT Group. He recibido tu mensaje ("${message}"). Por favor, indícate un número de solicitud válido (ej: sol-001 a sol-006) para validar las reglas RC1-RC10.`;
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
