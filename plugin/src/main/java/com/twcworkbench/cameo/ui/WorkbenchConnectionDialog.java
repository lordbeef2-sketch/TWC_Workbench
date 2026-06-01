package com.twcworkbench.cameo.ui;

import com.twcworkbench.cameo.config.PluginConfig;

import javax.swing.BorderFactory;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.SwingConstants;
import java.awt.Component;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;

public final class WorkbenchConnectionDialog {
    private WorkbenchConnectionDialog() {
    }

    public static boolean show(Component parent, PluginConfig config) {
        JTextField baseUrlField = new JTextField(nullToEmpty(config.workbenchBaseUrl), 34);
        JPasswordField ingestTokenField = new JPasswordField(nullToEmpty(config.workbenchIngestToken), 34);
        JTextField serverIdField = new JTextField(nullToEmpty(config.serverIdOverride), 24);
        JTextField connectTimeoutField = new JTextField(Integer.toString(config.connectTimeoutSeconds), 8);
        JTextField readTimeoutField = new JTextField(Integer.toString(config.readTimeoutSeconds), 8);
        JCheckBox insecureTlsBox = new JCheckBox("Disable TLS verification for Workbench HTTPS", config.insecureTls);
        JCheckBox snapshotOnOpenBox = new JCheckBox("Capture baseline on project open", config.snapshotOnOpen);
        JCheckBox snapshotOnSaveBox = new JCheckBox("Publish delta on project save (fallback to full snapshot if needed)", config.snapshotOnSave);

        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.insets = new Insets(4, 4, 4, 4);
        constraints.anchor = GridBagConstraints.WEST;
        constraints.fill = GridBagConstraints.HORIZONTAL;

        int row = 0;
        row = addRow(panel, constraints, row, "Workbench Base URL", baseUrlField);
        row = addRow(panel, constraints, row, "Ingest Bearer Token", ingestTokenField);
        row = addRow(panel, constraints, row, "Workbench Server ID", serverIdField);
        row = addRow(panel, constraints, row, "Connect Timeout (sec)", connectTimeoutField);
        row = addRow(panel, constraints, row, "Read Timeout (sec)", readTimeoutField);
        row = addRow(panel, constraints, row, "", insecureTlsBox);
        row = addRow(panel, constraints, row, "", snapshotOnOpenBox);
        row = addRow(panel, constraints, row, "", snapshotOnSaveBox);

        JLabel note = new JLabel("<html><body style='width: 420px'>"
                + "Workbench Server ID must exactly match the server profile id inside TWC Workbench, "
                + "such as <b>twc-2022x</b> or <b>twc-2024x</b>. "
                + "This plugin now performs an exact sync from the currently open remote TWC project and resolves workspace/resource identifiers automatically. "
                + "It publishes directly into TWC Workbench rather than writing local export files. "
                + "If your internal Workbench HTTPS certificate is not trusted by the JVM inside Cameo, you can temporarily enable the TLS bypass option above.</body></html>");
        note.setVerticalAlignment(SwingConstants.TOP);
        constraints.gridx = 0;
        constraints.gridy = row;
        constraints.gridwidth = 2;
        constraints.weightx = 1.0;
        panel.add(note, constraints);

        while (true) {
            int result = JOptionPane.showConfirmDialog(
                    parent,
                    panel,
                    "TWC Workbench Connection",
                    JOptionPane.OK_CANCEL_OPTION,
                    JOptionPane.PLAIN_MESSAGE
            );
            if (result != JOptionPane.OK_OPTION) {
                return false;
            }

            try {
                int connectTimeout = parsePositiveInt(connectTimeoutField.getText(), "Connect Timeout");
                int readTimeout = parsePositiveInt(readTimeoutField.getText(), "Read Timeout");
                config.applyEditableSettings(
                        baseUrlField.getText(),
                        new String(ingestTokenField.getPassword()),
                        snapshotOnOpenBox.isSelected(),
                        snapshotOnSaveBox.isSelected(),
                        insecureTlsBox.isSelected(),
                        connectTimeout,
                        readTimeout,
                        serverIdField.getText()
                );
                config.save();
                return true;
            }
            catch (IllegalArgumentException exception) {
                JOptionPane.showMessageDialog(parent, exception.getMessage(), "Invalid Workbench Configuration", JOptionPane.ERROR_MESSAGE);
            }
            catch (Exception exception) {
                JOptionPane.showMessageDialog(parent, exception.getMessage(), "Failed to Save Configuration", JOptionPane.ERROR_MESSAGE);
                return false;
            }
        }
    }

    private static int addRow(JPanel panel, GridBagConstraints constraints, int row, String label, JComponent field) {
        constraints.gridwidth = 1;
        constraints.weightx = 0.0;
        constraints.gridx = 0;
        constraints.gridy = row;
        if (label == null || label.isBlank()) {
            panel.add(new JLabel(""), constraints);
        }
        else {
            panel.add(new JLabel(label), constraints);
        }

        constraints.gridx = 1;
        constraints.weightx = 1.0;
        panel.add(field, constraints);
        return row + 1;
    }

    private static int parsePositiveInt(String rawValue, String label) {
        try {
            int value = Integer.parseInt(rawValue.trim());
            if (value <= 0) {
                throw new NumberFormatException();
            }
            return value;
        }
        catch (Exception exception) {
            throw new IllegalArgumentException(label + " must be a positive whole number.");
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
