import { notFound } from 'next/navigation';
import { TestEnvironmentShell } from '@/components/test/TestEnvironmentShell';
import { TEST_ENVIRONMENTS, getTestEnvironment } from '@/lib/testEnvironments';

export function generateStaticParams() {
  return TEST_ENVIRONMENTS.map(environment => ({ envId: environment.id }));
}

export default function TestEnvironmentPage({ params }: { params: { envId: string } }) {
  const environment = getTestEnvironment(params.envId);
  if (!environment) notFound();

  return <TestEnvironmentShell environment={environment} />;
}
