const fs = require('fs');
const mdContent = fs.readFileSync('../dados_consolidados_google_places.md', 'utf-8');
const lines = mdContent.split('\n').filter(line => line.startsWith('|') && !line.includes('Nome do Estabelecimento') && !line.includes('---'));

let leads = [];
lines.forEach((line, index) => {
  const cols = line.split('|').map(c => c.trim());
  if (cols.length > 5) {
    let telefone = cols[10] ? cols[10].replace(/\D/g, '') : '';
    if(telefone.startsWith('55')) telefone = telefone.substring(2);
    if(telefone.length >= 10) {
      leads.push({ id: `lead_${index}`, nome: cols[1], categoria: cols[2], bairro: cols[6], telefone: telefone });
    }
  }
});

fs.writeFileSync('src/data/leads.ts', `export interface Lead { id: string; nome: string; categoria: string; bairro: string; telefone: string; }\nexport const DATABASE: Lead[] = ${JSON.stringify(leads, null, 2)};`);
