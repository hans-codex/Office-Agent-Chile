import { SkillRegistry } from '../src/skills/SkillRegistry';
import path from 'path';

describe('SkillRegistry Unit Tests', () => {
    let registry: SkillRegistry;

    beforeEach(() => {
        registry = new SkillRegistry();
    });

    test('should discover and load root skills from disk', () => {
        const skills = registry.loadFromDisk();
        expect(skills.length).toBeGreaterThanOrEqual(5);

        const skillIds = skills.map(s => s.id);
        expect(skillIds).toContain('fullstack-engineer');
        expect(skillIds).toContain('product-manager');
        expect(skillIds).toContain('qa-security-auditor');
        expect(skillIds).toContain('research-analyst');
        expect(skillIds).toContain('team-lead-recruiter');
    });

    test('should correctly parse skill frontmatter and instructions', () => {
        const markdown = `---
id: test-analyst
name: Test Analyst
description: Analyzes tests and verification metrics.
category: Quality
recommendedTools:
  - code_execute
  - read_file
---

# Instructions
Always verify code changes with automated tests.
`;
        const parsed = registry.parseSkillMarkdown('test-analyst', markdown);
        expect(parsed.id).toBe('test-analyst');
        expect(parsed.name).toBe('Test Analyst');
        expect(parsed.description).toBe('Analyzes tests and verification metrics.');
        expect(parsed.category).toBe('Quality');
        expect(parsed.recommendedTools).toEqual(['code_execute', 'read_file']);
        expect(parsed.instructions).toContain('Always verify code changes with automated tests.');
    });

    test('should register a custom skill and retrieve it via get and getMany', () => {
        const customSkill = {
            id: 'devops-architect',
            name: 'DevOps Architect',
            description: 'Manages CI/CD and deployment pipelines',
            category: 'Infrastructure',
            recommendedTools: ['code_execute', 'list_files'],
            instructions: 'Ensure all builds and container checks pass.'
        };

        const registered = registry.registerSkill(customSkill, false);
        expect(registered.id).toBe('devops-architect');

        const fetched = registry.get('devops-architect');
        expect(fetched).toBeDefined();
        expect(fetched?.name).toBe('DevOps Architect');

        const multi = registry.getMany(['devops-architect', 'non-existent']);
        expect(multi.length).toBe(1);
        expect(multi[0].id).toBe('devops-architect');
    });

    test('getAll should return all loaded skills', () => {
        registry.loadFromDisk();
        const all = registry.getAll();
        expect(all.length).toBeGreaterThanOrEqual(5);
    });
});
