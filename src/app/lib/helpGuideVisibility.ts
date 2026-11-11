import type { AdminRole } from '../data/assignmentTypes';

type Audience = 'both' | 'opm' | 'csr';

// This controls guide presentation only. The actual permissions remain with the
// page controls and backend. Temporary CSR fleet coverage does not change the
// audience of the standard OPM management guides.
export const HELP_GUIDE_AUDIENCE = {
  'add-driver': 'opm',
  'add-truck': 'opm',
  'assign-task': 'csr',
  monitor: 'both',
  'review-documents': 'csr',
  deliveries: 'both',
  documents: 'both',
  reports: 'both',
  'driver-login': 'both',
  'driver-updates': 'both',
  settings: 'both',
  security: 'both',
} as const satisfies Record<string, Audience>;

export interface SearchableHelpTopic {
  id: string;
  category: string;
  title: string;
  summary: string;
  tags: string[];
}

export function visibleHelpTopics<T extends SearchableHelpTopic>(topics: T[], role: AdminRole | null): T[] {
  if (!role) return [];
  const audience = role === 'opm' ? 'opm' : 'csr';
  return topics.filter((topic) => {
    const allowed = HELP_GUIDE_AUDIENCE[topic.id as keyof typeof HELP_GUIDE_AUDIENCE];
    return allowed === 'both' || allowed === audience;
  });
}

export function filterHelpTopics<T extends SearchableHelpTopic>(topics: T[], category: string, search: string): T[] {
  const query = search.trim().toLowerCase();
  return topics.filter((topic) =>
    (category === 'All' || topic.category === category)
    && (!query || topic.title.toLowerCase().includes(query)
      || topic.summary.toLowerCase().includes(query)
      || topic.category.toLowerCase().includes(query)
      || topic.tags.some((tag) => tag.toLowerCase().includes(query))));
}

export function helpCategories(topics: SearchableHelpTopic[], order: string[]): string[] {
  return ['All', ...order.filter((name) => topics.some((topic) => topic.category === name))];
}
