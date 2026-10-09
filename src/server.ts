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

// Modelos válidos en la capa gratuita
const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

// Función de espera activa para reintentos
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

    for (const modelName of MODELS_TO_TRY) {
      // Intentar hasta 2 veces por modelo si da error de alta demanda (503)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: message,
          });
          reply = response.text || 'Sin respuesta del modelo.';
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          const is503 = err?.status === 503 || err?.message?.includes('503');
          if (is503 && attempt === 1) {
            console.warn(`[503] Modelo ${modelName} saturado. Reintentando en 1.5s...`);
            await sleep(1500);
            continue;
          }
          console.warn(`Error con modelo ${modelName}:`, err.message || err);
          break; // Pasar al siguiente modelo
        }
      }

      if (reply) break; // Éxito, salir del bucle
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
