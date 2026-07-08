import { Application, Screen, Page, Main, Section, Heading, Text, Button, Placeholder } from '@lamina/studio';

export default function EmptyStateScreen() {
  return (
    <Application>
      <Screen id="empty-state" title="Empty State">
        <Page>
          <Main>
            <Section>
              <Placeholder as="empty-state" label="No screens generated">
                This tests empty-state copy and persona blocker overlays.
              </Placeholder>
              <Heading>Nothing here yet</Heading>
              <Text>The flow graph should still show this as a complete terminal-capable screen.</Text>
              <Button trigger="recover">Recover</Button>
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
