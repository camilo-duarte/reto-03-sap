import express, { Request, Response } from 'express';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

// Configuración del cliente para OpenRouter
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://reto-03-sap.onrender.com',
    'X-Title': 'Reto 03 SAP',
  },
});

// Ruta principal de salud del servicio
app.get('/', (req: Request, res: Response) => {
  res.send('Servidor corriendo correctamente en Render con OpenRouter');
});

// Ejemplo de endpoint para procesar peticiones con la IA
app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'El campo message es requerido.' });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash', // Modelo gratuito en OpenRouter
      messages: [
        { role: 'user', content: message }
      ],
    });

    const reply = completion.choices[0]?.message?.content || 'Sin respuesta del modelo.';
    res.json({ success: true, response: reply });
  } catch (error: any) {
    console.error('Error al comunicarse con OpenRouter:', error);
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
