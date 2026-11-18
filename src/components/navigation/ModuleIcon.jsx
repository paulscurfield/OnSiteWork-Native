import {
  BriefcaseBusiness,
  CalendarDays,
  CalendarOff,
  Camera,
  ClipboardCheck,
  Clock3,
  HardHat,
  NotebookPen,
  ShoppingCart,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react';

const ICONS = {
  briefcase: BriefcaseBusiness,
  calendar: CalendarDays,
  'calendar-off': CalendarOff,
  camera: Camera,
  'clipboard-check': ClipboardCheck,
  clock: Clock3,
  'hard-hat': HardHat,
  notebook: NotebookPen,
  'shopping-cart': ShoppingCart,
  user: UserRound,
  users: UsersRound,
  wrench: Wrench,
};

export default function ModuleIcon({ name, className = 'h-5 w-5' }) {
  const Icon = ICONS[name] || BriefcaseBusiness;
  return <Icon aria-hidden="true" className={className} />;
}
