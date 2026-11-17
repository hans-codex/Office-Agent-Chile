import fs from 'fs';
import path from 'path';
import { SkillDefinition } from '@agent-office/core';

export class SkillRegistry {
    private skills: Map<string, SkillDefinition> = new Map();
    private skillsDir: string;
    private extraSkillDirs: string[] = [];

    constructor(skillsDir?: string) {
        // Resolve root skills directory whether running from root or packages/server
        const candidates = [
            skillsDir,
            path.resolve(process.cwd(), 'skills'),
            path.resolve(process.cwd(), '../../skills'),
            path.resolve(__dirname, '../../../../skills')
        ].filter(Boolean) as string[];

        this.skillsDir = candidates.find(dir => fs.existsSync(dir)) || path.resolve(process.cwd(), 'skills');

        if (!skillsDir) {
            const agentSkillCandidates = [
                path.resolve(process.cwd(), '.agents/skills'),
                path.resolve(process.cwd(), '../../.agents/skills'),
                path.resolve(__dirname, '../../../../.agents/skills')
            ];
            const foundAgentSkills = agentSkillCandidates.find(dir => fs.existsSync(dir));
            if (foundAgentSkills) {
                this.extraSkillDirs.push(foundAgentSkills);
            }
        }
    }

    public loadFromDisk(): SkillDefinition[] {
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }

        const dirsToScan = [this.skillsDir, ...this.extraSkillDirs];
        for (const baseDir of dirsToScan) {
            if (!fs.existsSync(baseDir)) continue;
            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = path.join(baseDir, entry.name, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                    try {
                        const raw = fs.readFileSync(skillFile, 'utf-8');
                        const parsed = this.parseSkillMarkdown(entry.name, raw);
                        this.skills.set(parsed.id, parsed);
                    } catch (e) {
                        console.warn(`[SkillRegistry] Failed to parse ${skillFile}:`, e);
                    }
                }
            }
        }
        return this.getAll();
    }

    public parseSkillMarkdown(folderName: string, content: string): SkillDefinition {
        const normalized = content.replace(/\r\n/g, '\n');
        const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

        let id = folderName;
        let name = folderName;
        let description = '';
        let category = 'General';
        const recommendedTools: string[] = [];
        let instructions = normalized.trim();

        if (fmMatch) {
            const frontmatter = fmMatch[1];
            instructions = fmMatch[2].trim();

            const lines = frontmatter.split('\n');
            let inToolsList = false;

            for (const line of lines) {
                if (line.trim().startsWith('- ') && inToolsList) {
                    recommendedTools.push(line.trim().slice(2).trim());
                    continue;
                }
                inToolsList = false;
                const colonIdx = line.indexOf(':');
                if (colonIdx === -1) continue;
                const key = line.slice(0, colonIdx).trim();
                const val = line.slice(colonIdx + 1).trim();

                if (key === 'id' && val) id = val;
                else if (key === 'name' && val) name = val;
                else if (key === 'description' && val) description = val;
                else if (key === 'category' && val) category = val;
                else if (key === 'recommendedTools') {
                    inToolsList = true;
                }
            }
        }

        return {
            id,
            name,
            description,
            category,
            recommendedTools,
            instructions,
            source: 'file'
        };
    }

    public registerSkill(skill: SkillDefinition, persistToDisk: boolean = false): SkillDefinition {
        const cleanId = skill.id
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || `skill-${Date.now()}`;

        const normalized: SkillDefinition = {
            id: cleanId,
            name: skill.name || cleanId,
            description: skill.description || 'Custom agent skill',
            category: skill.category || 'Custom',
            recommendedTools: Array.isArray(skill.recommendedTools) ? skill.recommendedTools : [],
            instructions: skill.instructions || '',
            source: persistToDisk ? 'file' : (skill.source || 'custom')
        };

        this.skills.set(cleanId, normalized);

        if (persistToDisk) {
            try {
                const targetDir = path.join(this.skillsDir, cleanId);
                fs.mkdirSync(targetDir, { recursive: true });
                const toolsYaml = normalized.recommendedTools && normalized.recommendedTools.length > 0
                    ? `\nrecommendedTools:\n${normalized.recommendedTools.map(t => `  - ${t}`).join('\n')}`
                    : '';
                const md = `---
id: ${normalized.id}
name: ${normalized.name}
description: ${normalized.description}
category: ${normalized.category || 'Custom'}${toolsYaml}
---

${normalized.instructions}
`;
                fs.writeFileSync(path.join(targetDir, 'SKILL.md'), md, 'utf-8');
            } catch (e) {
                console.warn(`[SkillRegistry] Could not write skill ${cleanId} to disk:`, e);
            }
        }

        return normalized;
    }

    public get(id: string): SkillDefinition | undefined {
        return this.skills.get(id);
    }

    public getMany(ids: string[]): SkillDefinition[] {
        return ids.map(id => this.skills.get(id)).filter(Boolean) as SkillDefinition[];
    }

    public getAll(): SkillDefinition[] {
        return Array.from(this.skills.values());
    }
}
