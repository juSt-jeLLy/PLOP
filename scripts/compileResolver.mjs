import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const resolverPath = path.resolve('contracts/DarkPoolResolver.sol');
const controllerPath = path.resolve('contracts/SettlementController.sol');
const interfacePath = path.resolve('contracts/interfaces/IExtendedResolver.sol');

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[Compile] Missing source: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

const input = {
  language: 'Solidity',
  sources: {
    'contracts/DarkPoolResolver.sol': { content: readSource(resolverPath) },
    'contracts/SettlementController.sol': { content: readSource(controllerPath) },
    'contracts/interfaces/IExtendedResolver.sol': { content: readSource(interfacePath) },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors?.length) {
  const fatal = output.errors.filter((e) => e.severity === 'error');
  for (const err of output.errors) {
    console.error(err.formattedMessage ?? err.message);
  }
  if (fatal.length) {
    process.exit(1);
  }
}

const contracts = [
  {
    source: 'contracts/DarkPoolResolver.sol',
    name: 'DarkPoolResolver',
    outputDir: 'artifacts/contracts/DarkPoolResolver.sol',
  },
  {
    source: 'contracts/SettlementController.sol',
    name: 'SettlementController',
    outputDir: 'artifacts/contracts/SettlementController.sol',
  },
];

for (const entry of contracts) {
  const compiled = output.contracts?.[entry.source]?.[entry.name];
  if (!compiled?.abi || !compiled?.evm?.bytecode?.object) {
    throw new Error(`[Compile] Missing abi/bytecode for ${entry.name}`);
  }

  const artifactDir = path.resolve(entry.outputDir);
  const artifactPath = path.join(artifactDir, `${entry.name}.json`);
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifact = {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log('Wrote artifact:', artifactPath);
}
