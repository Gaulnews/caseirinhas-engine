const fs = require('fs');
const readline = require('readline');

async function processarCSV() {
    // Verifica se o arquivo existe
    if (!fs.existsSync('dataset.csv')) {
        console.error('❌ Erro: O arquivo dataset.csv não foi encontrado na pasta.');
        return;
    }

    const fileStream = fs.createReadStream('dataset.csv');
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let leads = [];
    let isHeader = true;
    let headers = [];

    console.log('⏳ Lendo o dataset do Google Places e higienizando os dados...');

    for await (const line of rl) {
        // Regex blindado para separar CSV por vírgulas, ignorando as vírgulas dentro de aspas
        const columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/(^"|"$)/g, '').trim());

        if (isHeader) {
            headers = columns;
            isHeader = false;
            continue;
        }

        // Mapeamento dinâmico baseado nos cabeçalhos padrão do extrator do Apify
        const getCol = (name) => columns[headers.indexOf(name)] || '';

        const nome = getCol('title') || getCol('name') || columns[0] || 'Empresa';
        const telefoneRaw = getCol('phone') || getCol('phoneUnformatted') || getCol('phoneNumber') || '';
        const endereco = getCol('address') || getCol('neighborhood') || '';

        // Higienização: Remove parênteses, traços e espaços
        const telefoneLimpo = telefoneRaw.replace(/\D/g, '');

        // Regra de Ouro B2B: Só entra no Cérebro se tiver telefone válido
        if (telefoneLimpo.length >= 10) {
            
            // Lógica para extrair o Bairro do formato de endereço do Google (focado no padrão BR)
            let bairro = endereco;
            if (endereco.includes('-')) {
                const partes = endereco.split('-');
                bairro = partes.length > 1 ? partes[1].split(',')[0].trim() : endereco;
            }

            leads.push({
                id: `google_${leads.length + 1}`,
                nome: nome,
                bairro: bairro,
                telefone: telefoneLimpo
            });
        }
    }

    // Monta o arquivo TypeScript final
    const tsContent = `export interface Lead {
  id: string;
  nome: string;
  bairro: string;
  telefone: string;
}

export const DATABASE: Lead[] = ${JSON.stringify(leads, null, 2)};
`;

    // Injeta diretamente na pasta de dados do Next.js
    fs.writeFileSync('./src/data/leads.ts', tsContent);
    console.log(`✅ SUCESSO! ${leads.length} leads qualificados foram injetados no Cérebro da Vercel.`);
}

processarCSV();
