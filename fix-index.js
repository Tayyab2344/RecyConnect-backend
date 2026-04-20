import fs from 'fs';

const filePath = 'src/index.js';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  'import logRoutes from "./routes/logRoutes.js";',
  'import logRoutes from "./routes/logRoutes.js";\nimport complaintRoutes from "./routes/complaintRoutes.js";'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed index.js');
