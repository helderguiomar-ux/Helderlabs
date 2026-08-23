const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend', 'public', 'super-admin.html');
let content = fs.readFileSync(file, 'utf8');

// Replace  with appropriate character based on context
content = content.replace(/Gest.o/g, 'Gestão');
content = content.replace(/Gest..o/g, 'Gestão');
content = content.replace(/Permiss.es/g, 'Permissões');
content = content.replace(/permiss..es/g, 'permissões');
content = content.replace(/Monitoriza..o/g, 'Monitorização');
content = content.replace(/aplica....o/g, 'aplicação');
content = content.replace(/Relat..rios/g, 'Relatórios');
content = content.replace(/Configura.es/g, 'Configurações');
content = content.replace(/Visualiza....o/g, 'Visualização');
content = content.replace(/ecr../g, 'ecrã');
content = content.replace(/Y\?\/g, '??');
content = content.replace(/Y\'/g, '??');
content = content.replace(/Y\"\?/g, '??');
content = content.replace(/Y\'\?\/g, '???');
content = content.replace(/\?\? Suspender/g, '?? Suspender');

fs.writeFileSync(file, content, 'utf8');
