'use client';

import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts';

export function CapabilityChart({
  data,
  title,
}: {
  data: Array<{ label: string; cp: number; cpk: number; ppk?: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No capability chart data
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
          <YAxis domain={[0, 'auto']} />
          <Tooltip />
          <Legend />
          <ReferenceLine y={1.33} stroke="#d97706" strokeDasharray="4 4" />
          <Bar dataKey="cp" name="Cp" fill="#2563eb" />
          <Bar dataKey="cpk" name="Cpk" fill="#059669" />
          {data.some((d) => d.ppk != null) && <Bar dataKey="ppk" name="Ppk" fill="#7c3aed" />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CapabilityTrendChart({
  data,
  title,
}: {
  data: Array<{ month: string; cpk: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No trend data
      </div>
    );
  }
  return (
    <div className="h-[300px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 'auto']} />
          <Tooltip />
          <Legend />
          <ReferenceLine y={1.33} stroke="#d97706" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="cpk" name="Avg Cpk" stroke="#2563eb" strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CapabilityHistogram({
  data,
  title,
}: {
  data: Array<{ bin: string; count: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No histogram data
      </div>
    );
  }
  return (
    <div className="h-[240px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bin" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" name="Frequency" fill="#2563eb" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IndividualsChart({
  data,
  title,
}: {
  data: Array<{ i: number; x: number; ucl: number; lcl: number; cl: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No individuals chart data
      </div>
    );
  }
  return (
    <div className="h-[240px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="i" tick={{ fontSize: 10 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="x" name="X" stroke="#2563eb" strokeWidth={2} dot />
          <Line type="monotone" dataKey="ucl" name="UCL" stroke="#dc2626" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="lcl" name="LCL" stroke="#dc2626" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="cl" name="CL" stroke="#059669" strokeDasharray="2 2" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MovingRangeChart({
  data,
  title,
}: {
  data: Array<{ i: number; mr: number; ucl: number; cl: number }>;
  title?: string;
}) {
  if (!data.length) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No moving range data
      </div>
    );
  }
  return (
    <div className="h-[240px] w-full">
      {title && <p className="mb-2 text-sm font-medium">{title}</p>}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="i" tick={{ fontSize: 10 }} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="mr" name="MR" stroke="#7c3aed" strokeWidth={2} dot />
          <Line type="monotone" dataKey="ucl" name="UCL" stroke="#dc2626" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="cl" name="MR-bar" stroke="#059669" strokeDasharray="2 2" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
