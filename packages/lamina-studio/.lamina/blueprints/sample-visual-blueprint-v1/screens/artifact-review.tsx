import { Application, Screen, Page, Main, Section, Heading, Text, Button, Progress } from '@lamina/studio';

export default function ArtifactReviewScreen() {
  return (
    <Application>
      <Screen id="artifact-review" title="Artifact Review">
        <Page>
          <Main>
            <Section>
              <Heading>Artifact review</Heading>
              <Text>Use this run to verify rendered markdown, GFM tables, code blocks, and Mermaid source cards.</Text>
              <Progress value={72}>Artifact readiness</Progress>
              <Button trigger="finish">Finish review</Button>
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
