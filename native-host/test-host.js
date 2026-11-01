#!/usr/bin/env node

/**
 * Script de teste para native messaging host
 * Envia uma mensagem no formato correto (4 bytes length + JSON)
 */

const { spawn } = require('child_process');
const path = require('path');

const hostScript = path.join(__dirname, 'mysecrets-wrapper.sh');

// Mensagem de teste
const message = { command: 'status' };
const messageStr = JSON.stringify(message);
const messageBuffer = Buffer.from(messageStr, 'utf8');

// Cria buffer com tamanho (4 bytes) + mensagem
const lengthBuffer = Buffer.alloc(4);
lengthBuffer.writeUInt32LE(messageBuffer.length, 0);

const fullMessage = Buffer.concat([lengthBuffer, messageBuffer]);

console.log('Testando native host...');
console.log('Mensagem:', messageStr);
console.log('Tamanho:', messageBuffer.length, 'bytes');
console.log('');

// Inicia o host
const host = spawn(hostScript, [], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let responseData = Buffer.alloc(0);

host.stdout.on('data', (data) => {
  responseData = Buffer.concat([responseData, data]);
  
  // Verifica se temos pelo menos 4 bytes (tamanho)
  if (responseData.length >= 4) {
    const length = responseData.readUInt32LE(0);
    
    // Verifica se temos a mensagem completa
    if (responseData.length >= 4 + length) {
      const response = responseData.slice(4, 4 + length).toString('utf8');
      console.log('Resposta recebida:');
      console.log(JSON.parse(response));
      
      host.kill();
      process.exit(0);
    }
  }
});

host.on('error', (error) => {
  console.error('Erro ao iniciar host:', error);
  process.exit(1);
});

host.on('exit', (code) => {
  if (code !== 0) {
    console.error('Host terminou com código:', code);
    process.exit(1);
  }
});

// Envia mensagem
host.stdin.write(fullMessage);

// Timeout de 5 segundos
setTimeout(() => {
  console.error('Timeout - sem resposta do host');
  host.kill();
  process.exit(1);
}, 5000);
