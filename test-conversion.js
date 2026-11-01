// Teste da conversão do formato externo para MySecrets
const fs = require('fs');
const crypto = require('crypto');

// Função para gerar ID único
function generateId() {
    return crypto.randomUUID();
}

// Função para escapar HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Função de conversão (copiada do app.js)
function convertExternalToMySecrets(externalEntry) {
    const now = new Date().toISOString();
    
    // Extrair título baseado no label e issuer
    let title = externalEntry.issuer || 'MFA';
    let username = '';
    
    // Processar o label para extrair informações
    if (externalEntry.label) {
        const label = externalEntry.label;
        
        // Se contém ":", pode ser issuer:account
        if (label.includes(':')) {
            const parts = label.split(':');
            if (parts.length === 2) {
                const [labelIssuer, account] = parts;
                username = account.replace(/\\/g, '\\');
                // Se não temos issuer, usar o do label
                if (!externalEntry.issuer || externalEntry.issuer === labelIssuer) {
                    title = labelIssuer;
                }
            }
        } else if (label.includes('_')) {
            // Formato com underscore (ex: gitlab.exemplo.com_usuario@exemplo.com)
            const parts = label.split('_');
            if (parts.length >= 2) {
                username = parts.slice(1).join('_');
            }
        } else {
            username = label;
        }
        
        // Melhorar o título baseado no contexto
        if (username) {
            let cleanUsername = username.split('@')[0].split('\\').pop();
            
            title += ` - ${cleanUsername}`;
        }
    }
    
    // Definir URL baseada no issuer
    let url = '';
    const issuerLower = (externalEntry.issuer || '').toLowerCase();
    if (issuerLower.includes('microsoft')) {
        url = 'https://account.microsoft.com';
    }
    
    return {
        id: generateId(),
        title: title,
        type: 'mfa',
        url: url,
        username: username,
        password: '',
        mfaSecret: externalEntry.secret,
        mfaAlgorithm: externalEntry.type || 'totp',
        mfaPeriod: externalEntry.period || 30,
        mfaDigits: externalEntry.digits || 6,
        mfaCounter: externalEntry.counter || 0,
        mfaHash: (externalEntry.algorithm || 'sha1').toLowerCase(),
        notes: `Importado de autenticador externo\nIssuer: ${externalEntry.issuer}\nLabel: ${externalEntry.label}\nAlgoritmo: ${(externalEntry.algorithm || 'SHA1').toUpperCase()}\nDígitos: ${externalEntry.digits || 6}\nPeríodo: ${externalEntry.period || 30}s`,
        createdAt: now,
        updatedAt: now,
        tags: ['importado', 'mfa', ...(externalEntry.tags || []), issuerLower.replace(/\s+/g, '-')]
    };
}

// Ler o arquivo JSON do usuário
try {
    const jsonData = fs.readFileSync('teste.json', 'utf8');
    const externalEntries = JSON.parse(jsonData);
    
    console.log('📁 Arquivo teste.json carregado com sucesso!');
    console.log(`📊 Encontradas ${externalEntries.length} entradas\n`);
    
    // Converter cada entrada
    const convertedEntries = externalEntries.map((entry, index) => {
        console.log(`${index + 1}. Convertendo entrada:`);
        console.log(`   Issuer: ${entry.issuer}`);
        console.log(`   Label: ${entry.label}`);
        console.log(`   Secret: ${entry.secret.substring(0, 8)}...`);
        
        const converted = convertExternalToMySecrets(entry);
        console.log(`   ✅ Convertido para: ${converted.title}`);
        console.log(`   Username: ${converted.username}`);
        console.log(`   URL: ${converted.url}`);
        console.log('');
        
        return converted;
    });
    
    // Salvar arquivo convertido
    fs.writeFileSync('teste-convertido.json', JSON.stringify(convertedEntries, null, 2));
    
    console.log('✅ Conversão concluída!');
    console.log(`📝 Arquivo salvo como: teste-convertido.json`);
    console.log(`🎯 ${convertedEntries.length} entradas convertidas com sucesso`);
    
    console.log('\n📋 Resumo das entradas convertidas:');
    convertedEntries.forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.title} (${entry.mfaHash.toUpperCase()}, ${entry.mfaDigits} dígitos)`);
    });
    
} catch (error) {
    console.error('❌ Erro ao processar arquivo:', error.message);
}