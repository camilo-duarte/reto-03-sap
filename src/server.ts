import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

// Reconstruir __dirname para compatibilidad con ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir archivos estáticos de la carpeta 'web'
app.use(express.static(path.join(__dirname, '../web')));

// Configuración del cliente usando la API directa de Google Gemini
const openai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

// Endpoint de chequeo de salud
app.get('/health', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente en Render con Gemini API');
});

// Endpoint para procesar peticiones con la IA
app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: 'gemini-1.5-flash',
      messages: [
        { role: 'user', content: message }
      ],
    });

    const reply = completion.choices[0]?.message?.content || 'Sin respuesta del modelo.';
    res.json({ success: true, response: reply });
  } catch (error: any) {
    console.error('Error al comunicarse con Gemini API:', error);
    res.status(500).json({
      error: 'Error interno en el servidor',
      details: error.message || error,
    });
  }
});

// Puerto dinámico asignado por Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
