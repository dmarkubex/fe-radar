import { Activity, Bell, Newspaper, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const metrics = [
  { label: "信源分层", value: "T1 / T2 / T3" },
  { label: "处理频率", value: "每 6 小时" },
  { label: "日报时间", value: "08:00" }
];

const modules = [
  { title: "时间线", icon: Activity, text: "按发布时间查看行业动态与精选条目。" },
  { title: "告警", icon: Bell, text: "自家公司、事故和政策信号集中处理。" },
  { title: "日报", icon: Newspaper, text: "每日生成结构化产业情报摘要。" },
  { title: "后台", icon: Settings, text: "维护信源、实体词典和评分配置。" }
];

export default function HomePage(): React.JSX.Element {
  return (
    <main className="min-h-screen">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-zinc-500">远东控股产业情报雷达</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-zinc-950">FE-Radar</h1>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              面向电力、电线电缆、储能与能源行业的内部情报工作台。
            </p>
          </div>
          <Button>进入时间线</Button>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader>
                <CardTitle>{metric.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-zinc-950">{metric.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {modules.map((module) => (
            <Card key={module.title}>
              <CardHeader>
                <module.icon className="h-5 w-5 text-zinc-500" />
                <CardTitle>{module.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-zinc-600">{module.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
