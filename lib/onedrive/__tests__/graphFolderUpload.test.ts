import { describe, expect, it } from 'vitest';
import { isOneDriveItemInFolder } from '../graphFolderUpload';

describe('isOneDriveItemInFolder', () => {
  it('matches parent folder name and path', () => {
    expect(
      isOneDriveItemInFolder(
        { id: '1', name: 'a.pdf', parentName: 'Request-2092' },
        ['SAPSEND', 'TEC', 'SG', 'Request-2092']
      )
    ).toBe(true);
    expect(
      isOneDriveItemInFolder(
        {
          id: '1',
          name: 'a.pdf',
          parentPath: '/drives/x/root:/SAPSEND/TEC/SG/Request-2092',
        },
        ['SAPSEND', 'TEC', 'SG', 'Request-2092']
      )
    ).toBe(true);
    expect(
      isOneDriveItemInFolder(
        { id: '1', name: 'a.pdf', parentName: 'Request-1' },
        ['SAPSEND', 'TEC', 'SG', 'Request-2092']
      )
    ).toBe(false);
  });
});
