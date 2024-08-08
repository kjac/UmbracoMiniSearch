import express from 'express';

const app = express();
const PORT = 3001;

app.use(express.static('public'));

app.listen(PORT, () => console.log(`The client is running on: http://localhost:${PORT}`));