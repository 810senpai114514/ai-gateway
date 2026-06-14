import OpenAI from 'openai';

function readEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

const baseURL = readEnv('GATEWAY_BASE_URL', 'http://127.0.0.1:3000/v1');
const apiKey = readEnv('OPENAI_API_KEY', 'sk-local-test');
const model = readEnv('TEST_MODEL', 'glm-5');
const instructions = readEnv('TEST_INSTRUCTIONS', 'You are a coding assistant that talks like a pirate');
const input = readEnv('TEST_INPUT', 'Are semicolons optional in JavaScript?');
const targetProvider = readEnv('TARGET_PROVIDER', 'openai-main');
const streamMode = ['1', 'true', 'yes', 'on'].includes(readEnv('TEST_STREAM', 'false').toLowerCase());

const client = new OpenAI({
  apiKey,
  baseURL,
  defaultHeaders: targetProvider
    ? {
        'x-target-provider': targetProvider
      }
    : undefined
});

async function main() {
  console.log(
    `[responses.${streamMode ? 'stream' : 'create'}] baseURL=${baseURL} model=${model} targetProvider=${targetProvider || '<default>'}`
  );

  if (streamMode) {
    const textDeltas = [];
    const functionArgumentDeltas = [];
    const stream = client.responses.stream({
      model,
      instructions,
      input
    });

    stream.on('response.output_text.delta', (event) => {
      textDeltas.push(event.delta);
      process.stdout.write(event.delta);
    });
    stream.on('response.function_call_arguments.delta', (event) => {
      functionArgumentDeltas.push(event.delta);
    });

    const response = await stream.finalResponse();
    process.stdout.write('\n');
    console.log('--- stream summary ---');
    console.log(
      JSON.stringify(
        {
          id: response.id,
          status: response.status,
          model: response.model,
          output_text: response.output_text,
          output_types: Array.isArray(response.output) ? response.output.map((item) => item?.type) : [],
          text_delta_chars: textDeltas.join('').length,
          function_argument_delta_chars: functionArgumentDeltas.join('').length,
          usage: response.usage
        },
        null,
        2
      )
    );
    return;
  }

  const response = await client.responses.create({
    model,
    instructions,
    input
  });

  console.log('--- response summary ---');
  console.log(
    JSON.stringify(
      {
        id: response.id,
        status: response.status,
        model: response.model,
        output_text: response.output_text,
        usage: response.usage
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('responses.create failed');
  if (error && typeof error === 'object' && 'status' in error) {
    console.error('status:', error.status);
  }

  if (error && typeof error === 'object' && 'headers' in error) {
    console.error('headers:', error.headers);
  }

  if (error && typeof error === 'object' && 'error' in error) {
    console.error('error payload:', error.error);
  }

  console.error(error);
  process.exit(1);
});
