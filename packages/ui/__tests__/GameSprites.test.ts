describe('Game Sprite & Avatar Resolution', () => {
    const VALID_CHAR_KEYS = ['char_0', 'char_1', 'char_2', 'char_3', 'char_4', 'char_5'];

    function resolveAvatarTexture(avatar: string | undefined, textures: { exists: (k: string) => boolean }): string {
        return (avatar && textures.exists(avatar)) ? avatar : 'char_0';
    }

    const mockTextureManager = {
        exists: (key: string) => VALID_CHAR_KEYS.includes(key)
    };

    it('should resolve known avatars (char_0 to char_5) to themselves', () => {
        for (const key of VALID_CHAR_KEYS) {
            expect(resolveAvatarTexture(key, mockTextureManager)).toBe(key);
        }
    });

    it('should fallback to char_0 when avatar is empty or undefined', () => {
        expect(resolveAvatarTexture(undefined, mockTextureManager)).toBe('char_0');
        expect(resolveAvatarTexture('', mockTextureManager)).toBe('char_0');
    });

    it('should fallback to char_0 when avatar texture does not exist', () => {
        expect(resolveAvatarTexture('char_unknown', mockTextureManager)).toBe('char_0');
        expect(resolveAvatarTexture('dragon_boss', mockTextureManager)).toBe('char_0');
    });

    it('should detect when an agent avatar has changed to trigger sprite texture swap', () => {
        let currentKey = 'char_0';
        const agent = { avatar: 'char_3' };

        const nextKey = resolveAvatarTexture(agent.avatar, mockTextureManager);
        expect(nextKey).toBe('char_3');
        expect(nextKey !== currentKey).toBe(true);

        // Update texture
        currentKey = nextKey;
        expect(currentKey).toBe('char_3');
    });
});
