import { Application, Screen, Page, Main, Section, Heading, Text, Button, Field } from '@lamina/studio';

export default function RecoveryScreen() {
  return (
    <Application>
      <Screen id="recovery" title="Recovery Path">
        <Page>
          <Main>
            <Section>
              <Heading>Recovery path</Heading>
              <Text>Tests a second flow and a persona-specific blocker state.</Text>
              <Field name="email" label="Email for follow-up" type="email" />
              <Button trigger="resolve">Resolve</Button>
            </Section>
          </Main>
        </Page>
      </Screen>
    </Application>
  );
}
