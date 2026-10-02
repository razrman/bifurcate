import { createFileRoute } from "@tanstack/react-router";
import { BifurcationStage } from "@/components/bifurcation-stage";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BifurcationStage />;
}
