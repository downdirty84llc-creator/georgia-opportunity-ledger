/** Configuration-only readiness check: it does not send a message. */
export function emailConfigurationCheck(provider: string, apiKey: string) {
  const configuredProvider = provider || 'console';
  if (configuredProvider === 'console') {
    return {
      status: 'fail' as const,
      detail:
        'EMAIL_PROVIDER is console — production email attempts are refused.',
    };
  }
  if (configuredProvider !== 'resend' && configuredProvider !== 'postmark') {
    return {
      status: 'fail' as const,
      detail: 'EMAIL_PROVIDER is unsupported. Configure resend or postmark.',
    };
  }
  if (!apiKey.trim()) {
    return {
      status: 'fail' as const,
      detail: 'EMAIL_API_KEY is missing or blank — email attempts are refused.',
    };
  }
  return {
    status: 'pass' as const,
    detail: `${configuredProvider} with a key set; credential validity and inbox delivery not verified`,
  };
}
