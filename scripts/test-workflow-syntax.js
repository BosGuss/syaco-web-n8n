const fs = require('fs');

const files = [
  'workflows/flow1-solution-discovery.json',
  'workflows/flow2-content-publisher.json',
  'workflows/flow3-community-lead-assistant.json'
];

let hasError = false;

files.forEach(file => {
  console.log('=== Checking', file, '===');
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  wf.nodes.forEach(n => {
    if (n.type === 'n8n-nodes-base.code' && n.parameters && n.parameters.jsCode) {
      try {
        new Function('items', '$', '$input', '$json', '$node', n.parameters.jsCode);
        console.log('  ✔ Node', n.name, 'is valid JS');
      } catch (err) {
        console.error('  ❌ Node', n.name, 'SYNTAX ERROR:', err.message);
        hasError = true;
      }
    }
  });
});

if (hasError) {
  console.error('\n❌ Syntax errors found!');
  process.exit(1);
} else {
  console.log('\n✅ All Code nodes have valid JavaScript syntax!');
}
