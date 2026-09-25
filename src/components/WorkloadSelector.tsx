import { WORKLOADS, batchLabel, type WorkloadSize } from "../data/mockGpuData";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

export default function WorkloadSelector({
  selected,
  onSelect,
}: {
  selected: WorkloadSize;
  onSelect: (size: WorkloadSize) => void;
}) {
  return (
    <Tabs
      className="workload-selector"
      value={selected}
      onValueChange={(value) => onSelect(value as WorkloadSize)}
    >
      <TabsList aria-label="Workload size">
        {WORKLOADS.map((item) => (
          <TabsTrigger key={item.id} value={item.id}>
            <span>{item.label}</span>
            <small>{batchLabel(item.batch)}</small>
          </TabsTrigger>
        ))}
      </TabsList>
      {WORKLOADS.map((item) => (
        <TabsContent className="sr-only" key={item.id} value={item.id}>
          {item.label} workload: {batchLabel(item.batch)} inputs.
        </TabsContent>
      ))}
    </Tabs>
  );
}
