import { packClientInterface } from '#tools/pack/interface/PackClient.js';
import FileStream from '#/io/FileStream.js';

const cache = new FileStream('data/pack', true);
packClientInterface(cache, new Array(1024).fill(0));
console.log('Interface pack rebuilt.');
