const { createClient } = require('redis');

// Redis Cloud (не Upstash/Vercel KV — тот бесплатный тариф был уже занят
// bankrot-master, а второй Upstash попросил привязать карту) отдаёт обычный
// REDIS_URL, а не REST API вроде KV_REST_API_URL/TOKEN — поэтому здесь стоит
// стандартный клиент `redis`, а не `@vercel/kv`.
//
// Клиент создаётся один раз на "тёплый" процесс функции и переиспользуется
// между вызовами (иначе на каждый запрос уходило бы время на новое TCP-
// подключение) — тот же принцип, что с любым другим переиспользуемым
// соединением в serverless-функциях.
let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis client error:', err));
    clientPromise = client.connect().then(() => client).catch((err) => {
      clientPromise = null; // не кэшировать сломанное подключение — следующий вызов попробует заново
      throw err;
    });
  }
  return clientPromise;
}

module.exports = { getClient };
