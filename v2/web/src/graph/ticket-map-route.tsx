/**
 * Route entry of the ticket map, loaded lazily by the router. It owns the ReactFlow stylesheet so the CSS ships
 * in the map chunk only; `ticket-map.tsx` stays free of CSS imports so `node --test` can load it.
 */
import '@xyflow/react/dist/style.css';

export { ProjectMapPickerPage, RequestMapPage } from './ticket-map.tsx';
