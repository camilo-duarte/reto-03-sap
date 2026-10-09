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

// Alias y modelos estables compatibles con la capa gratuita
const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];

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

    // Recorrer los modelos candidatos
    for (const modelName of CANDIDATE_MODELS) {
      // Hasta 3 reintentos con incrementos de espera (2s, 4s, 6s) si hay pico de demanda (503/429)
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: message,
          });

          reply = response.text || 'Sin respuesta del modelo.';
          lastError = null;
          break; // Éxito
        } catch (err: any) {
          lastError = err;
          const isTransient = err?.status === 503 || err?.status === 429 || err?.message?.includes('503');

          if (isTransient && attempt < 3) {
            const delay = attempt * 2000;
            console.warn(`[503/429] ${modelName} ocupado (intento ${attempt}/3). Reintentando en ${delay / 1000}s...`);
            await sleep(delay);
            continue;
          }

          console.warn(`Error con modelo ${modelName}:`, err.message || err);
          break; // Si es otro error (p.ej. 404), pasar inmediatamente al siguiente modelo
        }
      }

      if (reply) break; // Si ya obtuvimos respuesta, salir del bucle
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
