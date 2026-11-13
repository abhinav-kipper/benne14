import { MemoryStore } from '@/lib/store/memory';
import { storeContract } from '../support/store-contract';

storeContract('memory', async () => new MemoryStore());
