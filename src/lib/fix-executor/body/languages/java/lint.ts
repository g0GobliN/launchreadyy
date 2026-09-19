export const CHECKSTYLE_CONFIG = `<?xml version="1.0"?>
<!DOCTYPE module PUBLIC
  "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN"
  "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
  <property name="severity" value="error"/>
  <module name="TreeWalker">
    <module name="UnusedImports"/>
    <module name="EqualsHashCode"/>
    <module name="EmptyCatchBlock"/>
    <module name="StringLiteralEquality"/>
    <module name="MagicNumber"/>
    <module name="VisibilityModifier"/>
  </module>
  <module name="NewlineAtEndOfFile"/>
</module>
`;
