// Importação do Proton Pass.
// Aceita os três formatos de export sem criptografia do Proton Pass:
//   - .zip  (contém "Proton Pass/data.json")
//   - data.json  ({ encrypted, vaults: { <id>: { name, items: [...] } } })
//   - .csv  (type,name,url,email,username,password,note,totp,createTime,modifyTime,vault)
// Carregado como script clássico no renderer; também exporta via module.exports
// para os testes em tests/.

/**
 * Lê um segredo TOTP em base32 ou uma URI otpauth://.
 * Retorna { secret, algoritmo, digitos, periodo } ou null se inválido.
 */
function parseImportTotp(bruto) {
    if (!bruto) return null;
    const valor = String(bruto).trim();
    let secret = valor, algoritmo = 'sha1', digitos = 6, periodo = 30;

    if (/^otpauth:\/\//i.test(valor)) {
        try {
            const u = new URL(valor);
            secret = u.searchParams.get('secret') || '';
            algoritmo = (u.searchParams.get('algorithm') || 'sha1').toLowerCase();
            digitos = parseInt(u.searchParams.get('digits') || '6', 10);
            periodo = parseInt(u.searchParams.get('period') || '30', 10);
        } catch (e) {
            return null;
        }
    }

    secret = secret.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
    if (!secret || !/^[A-Z2-7]+$/.test(secret)) return null;

    return { secret, algoritmo, digitos, periodo };
}

/** Detecta o objeto data.json do Proton Pass. */
function isProtonPassJson(parsed) {
    return !!(parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
              parsed.vaults && typeof parsed.vaults === 'object');
}

/** Detecta o CSV do Proton Pass pelo cabeçalho. */
function isProtonPassCsv(texto) {
    const cabecalho = String(texto).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
    return ['type', 'name', 'url', 'username', 'password', 'totp', 'vault']
        .every(c => cabecalho.split(',').map(s => s.trim()).includes(c));
}

/** Parser de CSV (RFC 4180): aspas, aspas escapadas e quebras de linha em campos. */
function parseCsv(texto) {
    const s = String(texto).replace(/^\uFEFF/, '');
    const linhas = [];
    let linha = [], campo = '', aspas = false;

    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (aspas) {
            if (c === '"') {
                if (s[i + 1] === '"') { campo += '"'; i++; }
                else aspas = false;
            } else {
                campo += c;
            }
        } else if (c === '"') {
            aspas = true;
        } else if (c === ',') {
            linha.push(campo); campo = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            linha.push(campo); campo = '';
            linhas.push(linha); linha = [];
        } else {
            campo += c;
        }
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

    return linhas.filter(l => l.some(v => v !== ''));
}

/** Converte o CSV do Proton Pass para o mesmo formato de itens do data.json. */
function protonPassCsvToJson(texto) {
    const [cabecalho, ...linhas] = parseCsv(texto);
    const col = {};
    cabecalho.forEach((nome, i) => { col[nome.trim().toLowerCase()] = i; });
    const v = (linha, nome) => (col[nome] == null ? '' : (linha[col[nome]] || '').trim());

    const vaults = {};
    linhas.forEach(linha => {
        const cofre = v(linha, 'vault') || 'Proton Pass';
        if (!vaults[cofre]) vaults[cofre] = { name: cofre, items: [] };

        vaults[cofre].items.push({
            state: 1,
            createTime: Number(v(linha, 'createtime')) || null,
            modifyTime: Number(v(linha, 'modifytime')) || null,
            data: {
                type: v(linha, 'type') || 'login',
                metadata: { name: v(linha, 'name'), note: v(linha, 'note') },
                content: {
                    itemEmail: v(linha, 'email'),
                    itemUsername: v(linha, 'username'),
                    password: v(linha, 'password'),
                    urls: v(linha, 'url').split(/,\s*/).filter(Boolean),
                    totpUri: v(linha, 'totp')
                },
                extraFields: []
            }
        });
    });

    return { encrypted: false, vaults };
}

/**
 * Converte o data.json do Proton Pass para entradas do MySecrets.
 * O MySecrets só tem login/mfa/note: cartão, identidade, alias, wifi, chave SSH
 * e itens personalizados viram notas estruturadas. Logins com TOTP geram uma
 * entrada MFA vinculada. Itens na lixeira (state 2) são ignorados.
 */
function convertProtonPassToMySecrets(proton, gerarId) {
    const resultado = [];
    const iso = (seg) => (seg ? new Date(seg * 1000).toISOString() : new Date().toISOString());
    const slug = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');

    const camposExtras = (dados) => (dados.extraFields || [])
        .filter(f => f && (f.fieldName || (f.data && f.data.content)))
        .map(f => ({
            id: gerarId(),
            name: f.fieldName || 'campo',
            value: f.data && f.data.content != null ? String(f.data.content) : '',
            type: f.type === 'hidden' ? 'password' : 'text'
        }));

    // Junta os campos de texto preenchidos de um objeto como "Rótulo: valor".
    const paresParaNota = (titulo, obj, ordem) => {
        const linhas = ['[' + titulo + ']'];
        const usados = new Set();
        (ordem || []).forEach(([chave, rotulo]) => {
            usados.add(chave);
            if (obj && obj[chave]) linhas.push(rotulo + ': ' + obj[chave]);
        });
        // Campos que o Proton Pass adicionar no futuro não se perdem.
        Object.keys(obj || {}).forEach(chave => {
            const valor = obj[chave];
            if (!usados.has(chave) && (typeof valor === 'string' || typeof valor === 'number') && valor !== '') {
                linhas.push(chave + ': ' + valor);
            }
        });
        return linhas.length > 1 ? linhas.join('\n') : '';
    };

    Object.values(proton.vaults || {}).forEach(cofre => {
        const nomeCofre = (cofre && cofre.name) || '';

        ((cofre && cofre.items) || []).forEach(item => {
            if (!item || !item.data || item.state === 2) return;

            const dados = item.data;
            const meta = dados.metadata || {};
            const conteudo = dados.content || {};
            const nome = (meta.name || '').trim() || '(sem titulo)';

            const tags = ['importado', 'proton-pass'];
            if (nomeCofre) tags.push(slug(nomeCofre));
            if (item.pinned) tags.push('favorito');

            const notaBase = [
                (meta.note || '').trim(),
                nomeCofre ? 'Cofre Proton Pass: ' + nomeCofre : ''
            ].filter(Boolean).join('\n\n');

            const base = {
                createdAt: iso(item.createTime),
                updatedAt: iso(item.modifyTime),
                tags: tags
            };
            const cf = camposExtras(dados);
            const nota = (titulo, corpo, extra) => Object.assign({}, base, {
                id: gerarId(),
                title: nome,
                type: 'note',
                url: '',
                username: '',
                password: '',
                notes: [corpo, notaBase].filter(Boolean).join('\n\n') || '(nota vazia no Proton Pass)',
                tags: titulo ? tags.concat([titulo]) : tags
            }, cf.length ? { customFields: cf } : {}, extra || {});

            if (dados.type === 'login') {
                const urls = (conteudo.urls || []).filter(Boolean);
                // Versões antigas do export usam "username"; as novas separam e-mail e usuário.
                const email = conteudo.itemEmail || '';
                const usuario = conteudo.itemUsername || conteudo.username || email;
                let notas = notaBase;
                if (urls.length > 1) {
                    notas = (notas ? notas + '\n\n' : '') +
                            'Outras URLs:\n' + urls.slice(1).map(u => '- ' + u).join('\n');
                }

                const campos = cf.slice();
                if (email && email !== usuario) {
                    campos.unshift({ id: gerarId(), name: 'E-mail', value: email, type: 'text' });
                }

                const entrada = Object.assign({}, base, {
                    id: gerarId(),
                    title: nome,
                    type: 'login',
                    url: urls[0] || '',
                    username: usuario,
                    password: conteudo.password || '',
                    notes: notas
                });
                if (campos.length) entrada.customFields = campos;

                const totp = parseImportTotp(conteudo.totpUri);
                if (totp) {
                    const mfaId = gerarId();
                    resultado.push(Object.assign({}, base, {
                        id: mfaId,
                        title: nome + ' (2FA)',
                        type: 'mfa',
                        url: urls[0] || '',
                        username: usuario,
                        password: '',
                        mfaSecret: totp.secret,
                        mfaAlgorithm: 'totp',
                        mfaPeriod: totp.periodo,
                        mfaDigits: totp.digitos,
                        mfaCounter: 0,
                        mfaHash: totp.algoritmo,
                        notes: 'Importado do Proton Pass (2FA de "' + nome + '")',
                        tags: tags.concat(['mfa'])
                    }));
                    entrada.linkedMfaId = mfaId;
                }

                resultado.push(entrada);

            } else if (dados.type === 'note') {
                resultado.push(nota(null, ''));

            } else if (dados.type === 'alias') {
                const alias = item.aliasEmail || '';
                resultado.push(nota('alias', alias ? '[Alias]\nE-mail: ' + alias : '', { username: alias }));

            } else if (dados.type === 'creditCard') {
                resultado.push(nota('cartao', paresParaNota('Cartao', conteudo, [
                    ['cardholderName', 'Titular'], ['cardType', 'Bandeira'], ['number', 'Numero'],
                    ['expirationDate', 'Validade'], ['verificationCode', 'CVV'], ['pin', 'PIN']
                ]), { username: conteudo.cardholderName || '' }));

            } else if (dados.type === 'identity') {
                resultado.push(nota('identidade', paresParaNota('Identidade', conteudo, [
                    ['fullName', 'Nome'], ['email', 'Email'], ['phoneNumber', 'Telefone'],
                    ['birthdate', 'Nascimento'], ['company', 'Empresa'], ['jobTitle', 'Cargo'],
                    ['streetAddress', 'Endereco'], ['city', 'Cidade'], ['stateOrProvince', 'Estado'],
                    ['zipOrPostalCode', 'CEP'], ['countryOrRegion', 'Pais'],
                    ['passportNumber', 'Passaporte'], ['licenseNumber', 'CNH'],
                    ['socialSecurityNumber', 'Documento']
                ]), { username: conteudo.email || conteudo.fullName || '' }));

            } else if (dados.type === 'wifi') {
                // A senha vai no campo de senha, não no texto da nota.
                const semSenha = Object.assign({}, conteudo, { password: '' });
                resultado.push(nota('wifi', paresParaNota('Wi-Fi', semSenha, [
                    ['ssid', 'Rede'], ['security', 'Seguranca']
                ]), {
                    username: conteudo.ssid || '',
                    password: conteudo.password || ''
                }));

            } else if (dados.type === 'sshKey') {
                resultado.push(nota('ssh', paresParaNota('Chave SSH', conteudo, [
                    ['publicKey', 'Chave publica'], ['privateKey', 'Chave privada']
                ])));

            } else {
                // Itens personalizados e tipos novos: guarda o que houver de texto.
                resultado.push(nota(dados.type ? slug(dados.type) : null,
                    paresParaNota(dados.type || 'Item', conteudo, [])));
            }
        });
    });

    return resultado;
}

/**
 * Extrai de um .zip o primeiro arquivo cujo nome satisfaz o predicado.
 * Suporta os métodos "stored" (0) e "deflate" (8), que é o que o Proton Pass gera.
 * Retorna o conteúdo como texto UTF-8, ou null se não encontrar.
 */
async function extractTextFromZip(buffer, predicado) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer instanceof ArrayBuffer ? buffer : bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const texto = (ini, fim) => new TextDecoder().decode(bytes.subarray(ini, fim));

    // Fim do diretório central: assinatura 0x06054b50, procurada de trás para frente.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo ZIP inválido');

    const total = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);

    for (let n = 0; n < total; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Arquivo ZIP inválido');
        const metodo = view.getUint16(p + 10, true);
        const tamanho = view.getUint32(p + 20, true);
        const lenNome = view.getUint16(p + 28, true);
        const lenExtra = view.getUint16(p + 30, true);
        const lenComent = view.getUint16(p + 32, true);
        const local = view.getUint32(p + 42, true);
        const nome = texto(p + 46, p + 46 + lenNome);
        p += 46 + lenNome + lenExtra + lenComent;

        if (!predicado(nome)) continue;

        const ini = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const dados = bytes.subarray(ini, ini + tamanho);

        if (metodo === 0) return new TextDecoder().decode(dados);
        if (metodo !== 8) throw new Error('Compressão do ZIP não suportada (método ' + metodo + ')');

        const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(fluxo).text();
    }
    return null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseImportTotp,
        isProtonPassJson,
        isProtonPassCsv,
        parseCsv,
        protonPassCsvToJson,
        convertProtonPassToMySecrets,
        extractTextFromZip
    };
}
