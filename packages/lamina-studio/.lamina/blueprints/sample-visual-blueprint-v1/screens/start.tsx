import { Application, Screen, Page, Header, Main, Section, Heading, Text, Button, Row, Metric } from '@lamina/studio';

export default function StartScreen() {
  return (
    <Application>
      <Screen id="start" title="Run Overview">
        <Page>
          <Header>
            <Heading level={1}>Run overview</Heading>
            <Text>Brand, run switcher, and artifact tabs are visible above the blueprint workspace.</Text>
          </Header>
          <Main>
            <Section>
              <Row>
                <Metric label="Flows" value="2" />
                <Metric label="Scenarios" value="6" />
                <Metric label="Artifacts" value="4" />
              </Row>
              <Button trigger="open-flow">Open flow</Button>
              <Button trigger="review-artifacts">Review artifacts</Button>
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
