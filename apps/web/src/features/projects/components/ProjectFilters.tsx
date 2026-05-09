import { Search } from 'lucide-react';
import { Button, Card, Input, Select } from '../../../../components/ui';

export type ProjectStageFilter = 'all' | 'decide' | 'build' | 'verify' | 'launch';
export type ProjectHealthFilter = 'all' | 'healthy' | 'attention';

interface ProjectFiltersProps {
  query: string;
  stage: ProjectStageFilter;
  health: ProjectHealthFilter;
  onQueryChange: (value: string) => void;
  onStageChange: (value: ProjectStageFilter) => void;
  onHealthChange: (value: ProjectHealthFilter) => void;
  onReset: () => void;
}

export function ProjectFilters({ query, stage, health, onQueryChange, onStageChange, onHealthChange, onReset }: ProjectFiltersProps) {
  return (
    <Card>
      <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_auto] lg:items-end">
        <div>
          <label htmlFor="project-search" className="text-label-m text-text-primary">Search projects</label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <Input
              id="project-search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by name, projectId, or stack"
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <label htmlFor="stage-filter" className="text-label-m text-text-primary">Stage</label>
          <Select id="stage-filter" className="mt-1.5" value={stage} onChange={(event) => onStageChange(event.target.value as ProjectStageFilter)}>
            <option value="all">All stages</option>
            <option value="decide">Decide</option>
            <option value="build">Build</option>
            <option value="verify">Verify</option>
            <option value="launch">Launch</option>
          </Select>
        </div>
        <div>
          <label htmlFor="health-filter" className="text-label-m text-text-primary">Health</label>
          <Select id="health-filter" className="mt-1.5" value={health} onChange={(event) => onHealthChange(event.target.value as ProjectHealthFilter)}>
            <option value="all">All health</option>
            <option value="healthy">Healthy</option>
            <option value="attention">Needs attention</option>
          </Select>
        </div>
        <Button variant="secondary" onClick={onReset}>Reset</Button>
      </div>
    </Card>
  );
}
