import { z } from 'zod';
import { mexcSpotRestClient } from '../../rest/spot-client.js';

export const getServerTime = {
  name: 'getServerTime',
  description:
    'Get the current MEXC Spot server time in milliseconds. No authentication required.',
  inputSchema: z.object({}),
  handler: async () => {
    return mexcSpotRestClient.get('/api/v3/time');
  },
};
