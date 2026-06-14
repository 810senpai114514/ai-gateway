import { describe, expect, it } from 'vitest';
import {
  findLatestGatewayRequestIdentityInMessages,
  mergeGatewayRequestIdentityMetadata,
  readGatewayRequestIdentityMetadata
} from './request-identity';

describe('agent request identity helpers', () => {
  it('merges and reads gateway request identity metadata', () => {
    const metadata = mergeGatewayRequestIdentityMetadata(
      {
        source: 'user-input'
      },
      {
        source: 'http_introspection',
        billingSubjectKey: 'tenant-a:user-1',
        userId: 'user-1',
        tenantId: 'tenant-a',
        organizationId: 'org-1',
        apiKeyId: 'key-1'
      }
    );

    expect(metadata).toMatchObject({
      source: 'user-input'
    });
    expect(readGatewayRequestIdentityMetadata(metadata)).toMatchObject({
      source: 'http_introspection',
      billingSubjectKey: 'tenant-a:user-1',
      userId: 'user-1',
      tenantId: 'tenant-a',
      organizationId: 'org-1',
      apiKeyId: 'key-1'
    });
  });

  it('finds the latest propagated request identity from session messages', () => {
    const messages = [
      {
        metadata: mergeGatewayRequestIdentityMetadata(undefined, {
          source: 'http_introspection',
          billingSubjectKey: 'tenant-a:user-1',
          userId: 'user-1',
          tenantId: 'tenant-a'
        })
      },
      {
        metadata: {}
      },
      {
        metadata: mergeGatewayRequestIdentityMetadata(undefined, {
          source: 'trusted_header',
          billingSubjectKey: 'tenant-b:user-2',
          userId: 'user-2',
          tenantId: 'tenant-b',
          apiKeyId: 'key-2'
        })
      }
    ];

    expect(findLatestGatewayRequestIdentityInMessages(messages)).toMatchObject({
      source: 'trusted_header',
      billingSubjectKey: 'tenant-b:user-2',
      userId: 'user-2',
      tenantId: 'tenant-b',
      apiKeyId: 'key-2'
    });
  });
});
