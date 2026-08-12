export interface Task {
  id: number;
  title: string;
  completed: boolean;
  group: "work" | "personal";
}
