'use strict';

const { createFilesystem } = require('../core/filesystem');

describe('Filesystem (VFS)', () => {
  let fs;

  beforeEach(() => {
    fs = createFilesystem();
  });

  describe('pwd()', () => {
    test('returns root by default', () => {
      expect(fs.pwd()).toBe('/');
    });
  });

  describe('mkdir()', () => {
    test('creates a directory', () => {
      const result = fs.mkdir('/home');
      expect(result.ok).toBe(true);
      expect(result.path).toBe('/home');
    });

    test('creates nested directories with parents flag', () => {
      const result = fs.mkdir('/home/user/docs', { parents: true });
      expect(result.ok).toBe(true);
      expect(result.path).toBe('/home/user/docs');
    });

    test('fails to create nested dirs without parents flag', () => {
      const result = fs.mkdir('/home/user/docs');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/parent directory does not exist/);
    });

    test('returns ok when directory already exists', () => {
      fs.mkdir('/home');
      const result = fs.mkdir('/home');
      expect(result.ok).toBe(true);
    });

    test('fails when path component is a file', () => {
      fs.write('/file', 'data');
      const result = fs.mkdir('/file/sub');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not a directory/);
    });
  });

  describe('cd()', () => {
    test('changes directory to valid path', () => {
      fs.mkdir('/home');
      const result = fs.cd('/home');
      expect(result.ok).toBe(true);
      expect(fs.pwd()).toBe('/home');
    });

    test('fails when directory does not exist', () => {
      const result = fs.cd('/nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no such directory/);
    });

    test('fails when target is a file', () => {
      fs.touch('/myfile');
      const result = fs.cd('/myfile');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not a directory/);
    });

    test('supports relative paths', () => {
      fs.mkdir('/home/user', { parents: true });
      fs.cd('/home');
      const result = fs.cd('user');
      expect(result.ok).toBe(true);
      expect(fs.pwd()).toBe('/home/user');
    });

    test('supports .. navigation', () => {
      fs.mkdir('/home/user', { parents: true });
      fs.cd('/home/user');
      fs.cd('..');
      expect(fs.pwd()).toBe('/home');
    });
  });

  describe('touch()', () => {
    test('creates a new empty file', () => {
      const result = fs.touch('/hello.txt');
      expect(result.ok).toBe(true);
      const content = fs.read('/hello.txt');
      expect(content.ok).toBe(true);
      expect(content.content).toBe('');
    });

    test('updates modified time on existing file', () => {
      fs.touch('/hello.txt');
      const stat1 = fs.stat('/hello.txt');
      fs.touch('/hello.txt');
      const stat2 = fs.stat('/hello.txt');
      expect(stat2.modified).toBeGreaterThanOrEqual(stat1.modified);
    });

    test('fails when parent dir does not exist', () => {
      const result = fs.touch('/nonexistent/file.txt');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no such directory/);
    });
  });

  describe('write() and read()', () => {
    test('writes and reads file content', () => {
      fs.write('/test.txt', 'hello world');
      const result = fs.read('/test.txt');
      expect(result.ok).toBe(true);
      expect(result.content).toBe('hello world');
    });

    test('creates file if it does not exist', () => {
      const result = fs.write('/new.txt', 'content');
      expect(result.ok).toBe(true);
      expect(result.bytes).toBe(7);
    });

    test('overwrites existing file content', () => {
      fs.write('/test.txt', 'first');
      fs.write('/test.txt', 'second');
      expect(fs.read('/test.txt').content).toBe('second');
    });

    test('read returns error for non-existent file', () => {
      const result = fs.read('/nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no such file/);
    });

    test('read returns error for directory', () => {
      fs.mkdir('/dir');
      const result = fs.read('/dir');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/is a directory/);
    });

    test('write returns error when writing to a directory path', () => {
      fs.mkdir('/dir');
      const result = fs.write('/dir', 'data');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/is a directory/);
    });

    test('write fails when parent does not exist', () => {
      const result = fs.write('/nonexistent/file.txt', 'data');
      expect(result.ok).toBe(false);
    });
  });

  describe('append()', () => {
    test('appends to existing file', () => {
      fs.write('/log.txt', 'line1\n');
      fs.append('/log.txt', 'line2\n');
      expect(fs.read('/log.txt').content).toBe('line1\nline2\n');
    });

    test('creates file if it does not exist', () => {
      fs.append('/new.txt', 'hello');
      expect(fs.read('/new.txt').content).toBe('hello');
    });

    test('fails to append to a directory', () => {
      fs.mkdir('/dir');
      const result = fs.append('/dir', 'data');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/is a directory/);
    });
  });

  describe('rm()', () => {
    test('removes a file', () => {
      fs.touch('/test.txt');
      const result = fs.rm('/test.txt');
      expect(result.ok).toBe(true);
      expect(fs.read('/test.txt').ok).toBe(false);
    });

    test('removes an empty directory', () => {
      fs.mkdir('/empty');
      const result = fs.rm('/empty');
      expect(result.ok).toBe(true);
    });

    test('fails to remove non-empty directory without recursive flag', () => {
      fs.mkdir('/dir');
      fs.touch('/dir/file.txt');
      const result = fs.rm('/dir');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not empty/);
    });

    test('removes non-empty directory with recursive flag', () => {
      fs.mkdir('/dir');
      fs.touch('/dir/file.txt');
      const result = fs.rm('/dir', { recursive: true });
      expect(result.ok).toBe(true);
    });

    test('cannot remove root', () => {
      const result = fs.rm('/');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/cannot remove root/);
    });

    test('fails for non-existent path', () => {
      const result = fs.rm('/nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no such file or directory/);
    });
  });

  describe('stat()', () => {
    test('stat on file returns file info', () => {
      fs.write('/test.txt', 'hello');
      const result = fs.stat('/test.txt');
      expect(result.ok).toBe(true);
      expect(result.type).toBe('file');
      expect(result.size).toBe(5);
      expect(result.name).toBe('test.txt');
    });

    test('stat on directory returns dir info', () => {
      fs.mkdir('/mydir');
      const result = fs.stat('/mydir');
      expect(result.ok).toBe(true);
      expect(result.type).toBe('dir');
      expect(result.children).toBe(0);
    });

    test('stat on root returns dir info', () => {
      const result = fs.stat('/');
      expect(result.ok).toBe(true);
      expect(result.type).toBe('dir');
    });

    test('stat fails for non-existent path', () => {
      const result = fs.stat('/nonexistent');
      expect(result.ok).toBe(false);
    });
  });

  describe('ls()', () => {
    test('lists root directory', () => {
      fs.touch('/a.txt');
      fs.mkdir('/subdir');
      const result = fs.ls('/');
      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(2);
    });

    test('lists contents of subdirectory', () => {
      fs.mkdir('/dir');
      fs.write('/dir/file1.txt', 'a');
      fs.write('/dir/file2.txt', 'b');
      const result = fs.ls('/dir');
      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(2);
    });

    test('defaults to current directory', () => {
      fs.mkdir('/home');
      fs.cd('/home');
      fs.touch('/home/file.txt');
      const result = fs.ls();
      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(1);
    });

    test('fails for non-existent path', () => {
      const result = fs.ls('/nonexistent');
      expect(result.ok).toBe(false);
    });

    test('fails when target is a file', () => {
      fs.touch('/file.txt');
      const result = fs.ls('/file.txt');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not a directory/);
    });
  });

  describe('cp()', () => {
    test('copies file content', () => {
      fs.write('/original.txt', 'content');
      const result = fs.cp('/original.txt', '/copy.txt');
      expect(result.ok).toBe(true);
      expect(fs.read('/copy.txt').content).toBe('content');
    });

    test('fails when source does not exist', () => {
      const result = fs.cp('/nonexistent', '/copy.txt');
      expect(result.ok).toBe(false);
    });

    test('fails when source is a directory', () => {
      fs.mkdir('/dir');
      const result = fs.cp('/dir', '/dir2');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/is a directory/);
    });
  });

  describe('mv()', () => {
    test('moves file to new location', () => {
      fs.write('/old.txt', 'data');
      const result = fs.mv('/old.txt', '/new.txt');
      expect(result.ok).toBe(true);
      expect(fs.read('/new.txt').content).toBe('data');
      expect(fs.read('/old.txt').ok).toBe(false);
    });

    test('renames file in same directory', () => {
      fs.write('/test.txt', 'content');
      const result = fs.mv('/test.txt', '/renamed.txt');
      expect(result.ok).toBe(true);
      expect(fs.read('/renamed.txt').content).toBe('content');
    });

    test('same source and destination returns ok', () => {
      fs.write('/file.txt', 'data');
      const result = fs.mv('/file.txt', '/file.txt');
      expect(result.ok).toBe(true);
    });

    test('fails when source does not exist', () => {
      const result = fs.mv('/nonexistent', '/dst');
      expect(result.ok).toBe(false);
    });

    test('fails when dest parent does not exist', () => {
      fs.touch('/file.txt');
      const result = fs.mv('/file.txt', '/no/such/dir/file.txt');
      expect(result.ok).toBe(false);
    });
  });

  describe('tree()', () => {
    test('returns tree representation', () => {
      fs.mkdir('/home/user', { parents: true });
      fs.touch('/home/user/notes.txt');
      const result = fs.tree('/');
      expect(typeof result).toBe('string');
      expect(result).toContain('home');
      expect(result).toContain('notes.txt');
    });

    test('returns error string for non-existent path', () => {
      const result = fs.tree('/nonexistent');
      expect(result).toContain('no such file or directory');
    });

    test('returns file name for file path', () => {
      fs.write('/file.txt', 'data');
      const result = fs.tree('/file.txt');
      expect(result).toContain('file.txt');
    });
  });

  describe('resolvePath()', () => {
    test('resolves relative paths from cwd', () => {
      fs.mkdir('/home', { parents: true });
      fs.cd('/home');
      expect(fs.resolvePath('test.txt')).toBe('/home/test.txt');
    });

    test('resolves absolute paths', () => {
      expect(fs.resolvePath('/etc/config')).toBe('/etc/config');
    });

    test('resolves . and .. segments', () => {
      expect(fs.resolvePath('/home/user/../test')).toBe('/home/test');
      expect(fs.resolvePath('/home/./user')).toBe('/home/user');
    });
  });

  describe('commands interface', () => {
    test('pwd command works', () => {
      const result = fs.commands.pwd([]);
      expect(result.status).toBe('ok');
      expect(result.result).toBe('/');
    });

    test('mkdir command works', () => {
      const result = fs.commands.mkdir(['/home']);
      expect(result.status).toBe('ok');
    });

    test('mkdir -p command works', () => {
      const result = fs.commands.mkdir(['/home/user/docs', '-p']);
      expect(result.status).toBe('ok');
    });

    test('touch command works', () => {
      const result = fs.commands.touch(['/file.txt']);
      expect(result.status).toBe('ok');
    });

    test('cat command reads file', () => {
      fs.write('/test.txt', 'hello');
      const result = fs.commands.cat(['/test.txt']);
      expect(result.status).toBe('ok');
      expect(result.result).toBe('hello');
    });

    test('write command writes file', () => {
      const result = fs.commands.write(['/test.txt', 'hello', 'world']);
      expect(result.status).toBe('ok');
      expect(fs.read('/test.txt').content).toBe('hello world');
    });

    test('rm command removes file', () => {
      fs.touch('/test.txt');
      const result = fs.commands.rm(['/test.txt']);
      expect(result.status).toBe('ok');
    });

    test('rm -r command removes directory recursively', () => {
      fs.mkdir('/dir');
      fs.touch('/dir/file.txt');
      const result = fs.commands.rm(['-r', '/dir']);
      expect(result.status).toBe('ok');
    });

    test('ls command works', () => {
      fs.touch('/file.txt');
      const result = fs.commands.ls(['/']);
      expect(result.status).toBe('ok');
    });

    test('stat command works', () => {
      fs.touch('/file.txt');
      const result = fs.commands.stat(['/file.txt']);
      expect(result.status).toBe('ok');
    });

    test('cp command works', () => {
      fs.write('/src.txt', 'data');
      const result = fs.commands.cp(['/src.txt', '/dst.txt']);
      expect(result.status).toBe('ok');
    });

    test('mv command works', () => {
      fs.write('/old.txt', 'data');
      const result = fs.commands.mv(['/old.txt', '/new.txt']);
      expect(result.status).toBe('ok');
    });

    test('cd command works', () => {
      fs.mkdir('/home');
      const result = fs.commands.cd(['/home']);
      expect(result.status).toBe('ok');
    });

    test('tree command works', () => {
      const result = fs.commands.tree(['/']);
      expect(result.status).toBe('ok');
    });
  });
});
