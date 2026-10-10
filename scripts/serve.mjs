import 'dotenv/config';
import app from '../src/app.js';
const port=Number(process.env.PORT)||3000;
app.listen(port,'0.0.0.0',()=>console.log(`LIFEGEN website + Admin portal ready on port ${port}. ${process.env.LOCAL_DEMO==='true'?'LOCAL POSTGRESQL DEMONSTRATION — no production data.':'Database credentials are server-side only.'}`));
