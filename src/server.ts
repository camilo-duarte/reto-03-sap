import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir archivos estáticos de la carpeta 'web'
app.use(express.static(path.join(__dirname, '../web')));

// Inicializar cliente oficial de Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
});

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente');
});

// Función de pausa/espera
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    let reply = '';
    let lastError: any = null;
    const maxRetries = 3;

    // Intentar hasta 3 veces con gemini-3.8-flash manejando picos 503
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: message,
        });

        reply = response.text || 'Sin respuesta del modelo.';
        lastError = null;
        break; // Respuesta exitosa
      } catch (err: any) {
        lastError = err;
        const isTransient = err?.status === 503 || err?.status === 429 || err?.message?.includes('503');

        if (isTransient && attempt < maxRetries) {
          const delay = attempt * 2000; // 2s, luego 4s
          console.warn(`[Intento ${attempt}/${maxRetries}] Pico de demanda en gemini-3.8-flash. Reintentando en ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }

        break;
      }
    }

    if (lastError && !reply) {
      throw lastError;
    }

    res.json({ success: true, response: reply });
  } catch (error: any) {
    console.error('Error al comunicarse con Gemini API:', error);
    res.status(500).json({
      error: 'Error interno en el servidor',
      details: error.message || error,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
