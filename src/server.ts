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

// Inicializar el cliente oficial de Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
});

app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente');
});

// Lista de modelos a intentar en orden en caso de saturación (503)
const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];

app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    let reply = '';
    let lastError: any = null;

    // Intentar con la lista de modelos de respaldo si uno falla
    for (const modelName of MODELS_TO_TRY) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: message,
        });
        reply = response.text || 'Sin respuesta del modelo.';
        lastError = null;
        break; // Éxito, salimos del ciclo
      } catch (err: any) {
        console.warn(`Error con el modelo ${modelName}, intentando siguiente...`, err.message || err);
        lastError = err;
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
