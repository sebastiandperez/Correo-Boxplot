export type RemoteBody =
  | Readonly<{
      kind: 'plain'
      text: string | null
      html: string | null
    }>
  | Readonly<{
      kind: 'boxplotE2ee'
      contentType: 'application/vnd.boxplot.e2ee+json'
      payload: string
    }>
