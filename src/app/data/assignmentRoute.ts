import type { Assignment } from './assignmentTypes';

type RouteAssignment = Pick<Assignment, 'destination' | 'destinationArea'>;

/** Keep the new write path off until the development migration has been applied. */
export const destinationAreaEnabled = import.meta.env.VITE_DESTINATION_AREA_ENABLED === 'true';

/** Existing destination stores "origin → exact delivery location". */
export function getDeliveryLocation(assignment: RouteAssignment): string {
  const route = assignment.destination ?? '';
  const arrow = route.lastIndexOf('→');
  return (arrow === -1 ? route : route.slice(arrow + 1)).trim();
}

/** New assignments show the general area; historical records keep their saved route. */
export function getAssignmentRoute(assignment: RouteAssignment): string {
  const area = assignment.destinationArea?.trim();
  if (!area) return assignment.destination || '—';
  const origin = assignment.destination.split('→')[0]?.trim();
  return origin ? `${origin} → ${area}` : area;
}
