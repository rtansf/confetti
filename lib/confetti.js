//
//  confetti - A Jquery Plugin for creating/updating schema-based JSON
//
//  Author: Rob Tan (rtansf@gmail.com)
//
//  For documentation see: https://github.com/rtansf/confetti/wiki/Confetti-User-Guide
//
(function ($) {
    $.fn.confetti = function (options) {
        // Default options
        var settings = $.extend({
            name: 'confetti',        // the default name for this editor
            schema: {},              // the schema
            instance: null,          // the instance. optional if we're creating a new instance
            save_callback: null,     // callback function for save button click
            cancel_callback: null,   // callback function for cancel button click
            error_callback: null,    // callback function for errors encountered during save
            closure_data: null,      // data to be passed back to caller in callbacks
	    readonly: false          // read only view       
        }, options);

        //
        // option_types map - used to lookup options for enum types when populating dropdowns
        //
        var option_types = {};

        //
        // for autocomplete widget
        //
        var option_lookups = {};
        var option_labels = {};

        // Initialization functions
        function init() {
            // init option_types
            for (var j = 0; j < settings.schema.option_types.length; j++) {
                var dd_type = settings.schema.option_types[j];
                var option_lookup = [];
                var option_label_map = {};
                option_types[dd_type.option_name] = dd_type;
                option_lookups[dd_type.option_name] = option_lookup;
                option_labels[dd_type.option_name] = option_label_map;
                for (var k = 0; k < dd_type.options.length; k++) {
                    var option = dd_type.options[k];
                    var opt_id = option.id;
                    var opt_label = option.label;
                    option_lookup.push({value: opt_label, data: {category: 'Available'}});
                    option_label_map[opt_label] = opt_id;
                }
            }
        }

        // Get the schema for a 'list' type
        function find_list_schema(parameters, current_list_name, search_list_name) {
            if (search_list_name === 'root') {
                return parameters;
            }

            for (var i = 0; i < parameters.length; i++) {
                var p = parameters[i];
                var fn = p['name'];
                if (fn === search_list_name) {
                    return p['type'];
                }
                if (Array.isArray(p['type'])) {
                    var r = find_list_schema(p['type'], fn, search_list_name);
                    if (r !== undefined) {
                        return r;
                    }
                }
            }
            return undefined;
        }

        // Element id generator for internal use
        var global_id = new Date().getTime();
        const ROOT_ID = global_id+1;

        function get_id() {
            return global_id++;
        }

        // Indent level - this is at the global scope (used when rendering tree from existing instance)
        var indent_level = -1;


        // Is field type an enum
        function is_enum_field_type(ftype) {
            if (ftype === 'string' || ftype === 'integer' || ftype === 'float' || ftype === 'boolean' ||
                ftype === 'cron' || ftype === 'date') {
                return false;
            } else {
                return true;
            }
        }

        //
        // Prepare and return the field html appropriate for the field type of the field
        //
        function get_field_html(field_def, field_value) {
            var field_name = field_def['name'];
            var field_type = field_def['type'];
            var fvalue = field_value;

            if (field_value === null || field_value === undefined) {
                fvalue = '';
            }

            // Get default value if specified in the field def
            if (field_value === '' && field_def['default_value'] !== undefined) {
                fvalue = field_def['default_value'];
            }

            // Adjust for booleans
            if (fvalue === '' && field_type === 'boolean') {
                fvalue = 'false';
            }

            var flabel = field_def['label'];

            var field = text_field_html;
            if (is_enum_field_type(field_type)) {
                var dd_type = option_types[field_type];
                var multiselect = dd_type.multiselect;
                var options = dd_type.options;
                if (options.length > 10 && !multiselect) {
                    field = autocomplete_field_html;
                    field = field.replace('@field_value@', fvalue);
                } else {
                    field = dropdown_field_html;
                    field = field.replace('@field_values@', fvalue);
                }
                field = field.replace('@enum_name@', field_type);
            } else if (field_type === 'boolean') {
                field = boolean_field_html;
                field = field.replace('@field_value@', fvalue);
            } else if (field_type === 'cron') {
                field = cron_field_html;
                field = field.replace('@field_value@', fvalue);
            } else if (field_type === 'integer') {
                field = integer_field_html;
                field = field.replace('@field_value@', fvalue);
            } else {
                field = field.replace('@field_value@', fvalue);
            }

            var field_id = get_id();
            field = field.replace('@field_id@', field_id);
            field = field.replace('@field_name@', field_name);
            field = field.replace('@field_label@', flabel);
            return field;
        }

        //
        // Add a field to a group
        //
        function add_field($group, field_def, field_html, level, add_delete_button) {

            // get the field_type from the schema
            var field_type = field_def['type'];

            // add this field to group
            $group.append(field_html);

            var $field = $group.find('.cfti_field:last()');
            var $field_control = null;

            // if field_type is enum type, create a select dropdown
            if (is_enum_field_type(field_type)) {
                var field_control_type = $field.attr('cfti_control_type');
                if (field_control_type == 'dropdown') {
                    var field_values = $field.attr('cfti_field_values');
                    var $select = $field.find('select');
                    var dd_type = option_types[field_type];
                    var options = dd_type.options;
                    var multiselect = dd_type.multiselect;
                    $field_control = $select;
                    populate_select($select, field_values, options, multiselect);
                } else if (field_control_type == 'autocomplete') {
                    var field_value = $field.attr('cfti_field_value');
                    var $input = $field.find('input');
                    var dd_type = option_types[field_type];
                    var options = dd_type.options;
		    $field_control = $input;
                    populate_autocomplete($input, field_value, options);

                    var option_lookup = option_lookups[field_type];
                    $input.devbridgeAutocomplete({
                        lookup: option_lookup,
                        showNoSuggestionNotice: true,
                        noSuggestionNotice: 'Sorry, no matching results',
                        groupBy: 'categpry'
                    });
                }
            } else if (field_type === 'date') {
                // if field_type is date, create a datepicker
                try {
                    $field.find('input').datepicker({format: 'yyyy-mm-dd'});
                    $field_control = $field.find('input');
                } catch (err) {
                    // ignore -- if datepicker not available (dont make this a fatal)
                }
            } else if (field_type === 'cron') {
                // if field_type is cron, create a cron editor
                try {
                    var field_value = $field.attr('cfti_field_value');
                    if (field_value === '') {
                        field_value = '0 * * * *';
                        $field.attr('cfti_field_value', field_value);
                    }
                    $field_control = $field.find('.cfti_cron');
                    $field.data('cron_object', $field.find('.cfti_cron').cron({initial: field_value}));
                } catch (err) {
                    console.log(err);
		    $field_control.text(field_value);
                    // ignore -- if croneditor not available (dont make this a fatal)
                }
            } else if (field_type === 'boolean') {
                var field_value = $field.attr('cfti_field_value');
                var $select = $field.find('select');
                $select.val(field_value);
                $field_control = $select;
            } else {
                // Fallthrough case is vanilla input field
                $field_control = $field.find('input');
            }

            // If this field is readonly, disable it
            if (field_def['readonly'] || settings.readonly) {
                $field_control.prop('disabled', true);
            }

            // add delete button if necessary
            // add_delete_button flag is set true only if this is the first field in the group and
            // this group is not the first group
            if (add_delete_button) {
                $group.find('.cfti_fieldinput:last()').after(delete_button_html);
                $group.find('.cfti_delgroupbutton:last()').click(function () {
                    $group.remove();
                });
            }

            // indent this field
            for (var i = 0; i < level; i++) {
                $group.find('.control-label:last()').before(indent_html);
            }
        }

        //
        // Populate the selection dropdown
        //
        function populate_select($select, field_values, options, multiselect) {
            if (multiselect) {
                $select.attr('multiple', true);
                $select.attr('size', 4);
            } else if (options.length > 10) {
                $select.attr('size', 4);
            }
            var field_values_array = field_values.split(',');
            for (var i = 0; i < options.length; i++) {
                var option = options[i];
                var selected = '';
                if (field_values_array.includes(option.id)) {
                    selected = 'selected';
                }
                var option_html = '<option ' + selected + ' value = "' + option.id + '">' + option.label + '</option>';
                $select.append(option_html);
            }
        }

        //
        // Populate the autocomplete box
        //
        function populate_autocomplete($input, field_value, options) {
            if (field_value === '') {
                $input.val('');
                return;
            }
            for (var i = 0; i < options.length; i++) {
                var option = options[i];
                if (field_value === option.id) {
                    $input.val(option.label);
                    break;
                }
            }
        }
        
        //
        // Add a new group to an existing list
        // Triggered when addgroup button is clicked
        //
        function add_new_group($list, group) {

            var group_id = get_id();
            var g_html = group_html;
            g_html = g_html.replace('@group_id@', group_id);

            // Add new group just before 1st group or if list is empty add it to the list
            var only_child_group = false;
            var $child_groups = $list.find('.group');
            if ($child_groups.length == 0) {
                $list.append(g_html);
                only_child_group = true;
            } else {
                $list.find('.group:first()').before(g_html);
            }

            var level = parseInt($list.attr('indent_level'));

            // Get group for inserting the field
            var $group = $('#' + group_id);

            var lists = [];

            for (var i = 0; i < group.length; i++) {
                var field = group[i];
                var field_name = field['name'];
                if (Array.isArray(field['type'])) {
                    //lists.push({parameter: field_name, 'list': []});
                    add_new_list($group, [], field_name, level + 1);
                } else {
                    var field_html = get_field_html(field, '');
                    var add_delete_button = false;
                    //if (i == 0 && !only_child_group) {
                    if (i === 0) {
                        add_delete_button = true;
                    }
                    add_field($group, field, field_html, level, add_delete_button);
                }
            }

            // Now add the lists to this parentgroup
            for (var j = 0; j < lists.length; j++) {
                var list_item = lists[j];
                var list_name = list_item['parameter'];
                var list = list_item['list'];
                var $parentgroup = $group;
                add_new_list($parentgroup, list, list_name, level + 1);
            }
        }

        //
        // Render a group from an existing instance
        // A group consists of fields and one or more lists
        //
        function render_group($list, group, list_name) {

            var group_id = get_id();
            //console.log('rendering group: ' + group_id + ' for list: ' + list_name + " list_id: " + $list.attr('id'));

            var g_html = group_html;
            g_html = g_html.replace('@group_id@', group_id);

            var only_child_group = false;
            var $child_groups = $list.find('.group');
            if ($child_groups.length == 0) {
                only_child_group = true;
            }
            $list.append(g_html);

            var $group = $('#' + group_id);

            var first_field = true;
            var lists = [];

            // need to preserve order of field rendering. use the schema to drive this
            var list_schema = find_list_schema(settings.schema['parameters'], 'root', list_name);
            for (var n = 0; n < list_schema.length; n++) {
                var p = list_schema[n];
                var field_name = p['name'];
                if (Array.isArray(p['type'])) {
                    render_list($group, p, group[field_name], field_name);
                    //lists.push({parameter: field_name, 'list': group[field_name], 'list_def': p});
                } else {
                    var field_html = get_field_html(p, group[field_name]);
                    var add_delete_button = false;
                    //if (first_field && list_name != 'root' && !only_child_group) {
                    if (first_field && list_name !== 'root') {
                        add_delete_button = true;
                        first_field = false;
                    }
                    add_field($group, p, field_html, indent_level, add_delete_button);
                }
            }

            for (var i = 0; i < lists.length; i++) {
                var list_item = lists[i];
                var list_def = list_item['list_def'];
                var list_name = list_item['parameter'];
                var list = list_item['list'];
                var $parentgroup = $group;
                render_list($parentgroup, list_def, list, list_name);
            }

            //console.log('finished rendering group: ' + group_id + ' for list: ' + list_name + " list_id: " + $list.attr('id'));
        }

        //
        // Add a new list - called by add new group (triggered by addgroup button click
        //
        function add_new_list($parentgroup, list, list_name, level) {

            // render list
            var list_id = get_id();
            //console.log('rendering list: ' + list_name + " list_id: " + list_id);

            var list_html = non_root_list_html;
            list_html = list_html.replace('@list_id@', list_id);

            var label = list_name;

            list_html = list_html.replace('@list_name@', list_name);
            list_html = list_html.replace('@list_label@', label);
            list_html = list_html.replace('@indent_level@', level);

            var addgroup_button_id = get_id();
            list_html = list_html.replace('@addgroup_button_id@', addgroup_button_id);

            $parentgroup.append(list_html);
            var $list = $('#' + list_id);

            // indent this list
            for (var i = 0; i < level; i++) {
                $list.find('.control-label:last()').before(indent_html);
            }

            bind_addgroup_button_click_event($list, addgroup_button_id);
            $('#' + addgroup_button_id).click();

            //console.log('finished rendering list: ' + list_name + " list_id: " + list_id);
        }

        //
        // Render a list from an existing instance
        // A list consists of one or more groups
        //
        function render_list($parentgroup, list_def, list, list_name) {

            indent_level++;

            // render list
            var list_html = root_list_html;
            var list_id = get_id();

            //console.log('rendering list: ' + list_name + " list_id: " + list_id);

            if (list_name !== 'root') {
                list_html = non_root_list_html;
                var label = list_def['label'];

                list_html = list_html.replace('@list_name@', list_name);
                list_html = list_html.replace('@list_label@', label);
                list_html = list_html.replace('@indent_level@', '' + indent_level);

                var addgroup_button_id = get_id();
                list_html = list_html.replace('@addgroup_button_id@', addgroup_button_id);
            }
            list_html = list_html.replace('@list_id@', list_id);

            $parentgroup.append(list_html);
            var $list = $('#' + list_id);

            // indent this list
            for (var i = 0; i < indent_level; i++) {
                $list.find('.control-label:last()').before(indent_html);
            }

            // Add groups for this list
            for (var i = 0; i < list.length; i++) {
                var group = list[i];
                render_group($list, group, list_name);
            }

            bind_addgroup_button_click_event($list, addgroup_button_id);

            indent_level--;
            //console.log('finished rendering list: ' + list_name + " list_id: " + list_id);
        }

        //
        // Bind the add group button click event
        // This will add a new group to the existing list
        //
        function bind_addgroup_button_click_event($list, addgroup_button_id) {
            // bind the addgroup button for this list
            $('#' + addgroup_button_id).click(function () {

                var list_name = $list.attr('cfti_list_name');
                var this_list_name = list_name;

                // get the list hierarchy
                var list_names = [];
                list_names.push(list_name);

                var done = false;
                var $l = $list;
                while (!done) {
                    $l = $l.parent().closest('.list');
                    list_name = $l.attr('cfti_list_name');
                    if (list_name == 'root') {
                        done = true;
                    } else {
                        list_names.push(list_name);
                    }
                }

                var parameters = settings.schema['parameters'];
                var list_name = list_names.pop();
                var parameter = find_param(parameters, list_name);

                while (list_names.length > 0) {
                    list_name = list_names.pop();
                    parameters = parameter['type'];
                    parameter = find_param(parameters, list_name);
                }

                group = parameter['type'];
                add_new_group($list, group)

                //console.log(list_names);
            });
        }

        //
        // Populate the data instance from the DOM representation - triggerd by Save button click
        //
        function populate_list($list, list) {
            console.log('pop list for: ' + $list.attr('cfti_list_name'));

            var child_group_ids = [];
            $list.children().each(function () {
                var $this = $(this);
                if ($this.hasClass('group')) {
                    child_group_ids.push($this.attr('id'));
                }
            });

            var numgroups = child_group_ids.length;
            for (var j = 0; j < numgroups; j++) {
                var child_group_id = child_group_ids[j];
                var $group = $('#' + child_group_id);
                var group = {};
                list.push(group);
                console.log('processing group: ' + j + ' id: ' + $group.attr('id'));
                $group.children().each(function (j) {
                    if ($(this).hasClass('cfti_field')) {
                        var field_name = $(this).attr('cfti_field_name');
                        var field_type = $(this).attr('cfti_field_type');
                        var field_control_type = $(this).attr('cfti_control_type');
                        var field_value = '';
                        if (!is_enum_field_type(field_type) && field_type !== 'boolean' && field_type !== 'cron') {
                            // Handle regular scalar input
                            field_value = $(this).find('input').val();
                            if (field_type === 'integer') {
                                field_value = parseInt(field_value);
                                if (isNaN(field_value)) {
                                    if (settings.error_callback !== null) {
                                        var msg = 'Invalid integer value for ' + field_name;
                                        settings.error_callback(msg, settings.closure_data);
                                    }
                                }
                            }
                        } else if (field_type === 'cron') {
                            // Handle cron input
                            var $cron_object = $(this).data('cron_object');
                            field_value = $cron_object.cron("value");
                        } else {
                            // Handle enum input
                            if (field_control_type === 'autocomplete') {
                                field_value = $(this).find('input').val();
                                // field_value above is the option label so we need to look up the option id
                                var dd_type = option_types[field_type];
                                var option_label_map = option_labels[dd_type.option_name];
                                field_value = option_label_map[field_value];
                            } else {
                                var pgs = '';
                                $(this).find('select option:selected').each(function () {
                                    if (pgs !== '') {
                                        pgs = pgs + ',' + $(this).val();
                                    } else {
                                        pgs = $(this).val();
                                    }
                                    field_value = pgs;
                                });
                                if (field_type === 'boolean') {
                                    field_value = field_value === 'true';
                                }
                            }
                        }
                        group[field_name] = field_value;
                    } else {
                        // recursively process this list
                        var list_name = $(this).attr('cfti_list_name');
                        group[list_name] = [];
                        populate_list($(this), group[list_name]);
                    }
                });
                console.log('finished processing group: ' + j + ' id: ' + $group.attr('id'));
            }
            //console.log(list);
            console.log('finish pop list for: ' + $list.attr('cfti_list_name'));

        }

        // Entry point for ppulating data instance from DOM
        function populate_instance() {
            var $list = $('#' + ROOT_ID);
            var list = [];
            populate_list($list, list);
            return list[0];
        }

        // Bind click event on save button
        function bind_save_button_click($button) {
            $button.click(function () {
                var instance = populate_instance();
                if (settings.save_callback !== null) {
                    settings.save_callback(instance, settings.closure_data);
                }
            });
        }

        // Bind click event on cancel button
        function bind_cancel_button_click($button) {
            $button.click(function () {
                if (settings.cancel_callback !== null) {
                    settings.cancel_callback(settings.closure_data);
                }
            });
        }

        // Find a parameter in a parameter list with a given name
        function find_param(parameters, name) {
            for (var i = 0; i < parameters.length; i++) {
                p = parameters[i];
                if (p['name'] === name) {
                    return p;
                }
            }
            return null;
        }

        //
        // Create template instance from schema
        // This will be used to configure a new instance
        //
        function template_instance(parameters, tins) {
            for (var i = 0; i < parameters.length; i++) {
                var p = parameters[i];
                var field_name = p['name'];
                if (Array.isArray(p['type'])) {
                    var new_tins = {};
                    tins[field_name] = [new_tins];
                    template_instance(p['type'], new_tins);
                } else {
                    tins[field_name] = '';
                }
            }
        }

        function create_template_instance(atype) {
            var tins = {};
            var parameters = atype['parameters'];
            template_instance(parameters, tins);
            return tins;
        }

        //
        // HTML fragment templates
        //

        var indent_html = '<label class="control-label col-sm-1">&nbsp;</label>';

        var delete_button_html = `
<div class="col-sm-2">
   <div class="cfti_delgroupbutton cfti_actionbutton"></div>
</div>
`;

        var text_field_html = `
<div class="form-group cfti_field" id="@field_id@" cfti_field_type="string" cfti_field_name="@field_name@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <input type="input" class="form-control" placeholder="" value="@field_value@"/>
   </div>
</div>
`;

        var autocomplete_field_html = `
<div class="form-group cfti_field" id="@field_id@" cfti_field_type="@enum_name@" cfti_control_type="autocomplete" cfti_field_name="@field_name@" cfti_field_value="@field_value@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <input type="input" class="form-control" value="@field_value@"/>
   </div>
</div>
`;

        var integer_field_html = `
<div class="form-group cfti_field" id="@field_id@" cfti_field_type="integer" cfti_field_name="@field_name@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <input type="input" class="form-control" placeholder="" value="@field_value@"/>
   </div>
</div>
`;

        var cron_field_html =
            `<div class="form-group cfti_field" id="@field_id@" cfti_field_type="cron" cfti_field_name="@field_name@" cfti_field_value="@field_value@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <div class="form-control cfti_cron"></div>
   </div>
</div>
`;

        var dropdown_field_html = `
<div class="form-group cfti_field" id="@field_id@" cfti_field_type="@enum_name@" cfti_control_type="dropdown" cfti_field_name="@field_name@" cfti_field_values="@field_values@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <select class="form-control"></select>
   </div>
</div>
`;

        var boolean_field_html = `
<div class="form-group cfti_field" id="@field_id@" cfti_field_type="boolean" cfti_field_name="@field_name@" cfti_field_value="@field_value@">
   <label class="control-label col-sm-2">@field_label@:</label>
   <div class="col-sm-4 cfti_fieldinput">
       <select class="form-control">
          <option>true</option>
          <option>false</option>
       </select>
   </div>
</div>
`;

        var group_html = `
<div class="group" id="@group_id@"></div>
`;

        var non_root_list_html = `
<div class="list" cfti_list_name="@list_name@" id="@list_id@" indent_level="@indent_level@">
   <div class="form-group">
   <label class="control-label col-sm-2">@list_label@</label>
      <div class="col-sm-2">
          <div class="cfti_addgroupbutton cfti_actionbutton" id="@addgroup_button_id@"></div>
      </div>
   </div>
</div>
`;

        var root_list_html = `
<div class="list" cfti_list_name="root" id="@list_id@" indent_level="0">
</div>
`;
        var buttons_html = `
<hr/>
<button class="cfti_savecancel cfti_savebutton">Save</button>
<button class="cfti_savecancel cfti_cancelbutton">Cancel</button>
`
        //
        //  Main Flow
        //
        init();

        var group_id = get_id();
        g_html = group_html;
        g_html = g_html.replace('@group_id@', group_id);

        this.append(g_html);
        var $parentgroup = $('#' + group_id);

        if (settings.instance === null) {
            // This path is taken when we are creating a new instance
            var template_instance = create_template_instance(settings.schema);
            render_list($parentgroup, null, [template_instance], 'root');
        } else {
            // This path is taken when we are updating an existing instance
            render_list($parentgroup, null, [settings.instance], 'root');
        }

        // Create save and cancel buttons
	if (!settings.readonly) {
            this.append(buttons_html);
            bind_save_button_click(this.find('.cfti_savebutton'));
            bind_cancel_button_click(this.find('.cfti_cancelbutton'));
	} else {
	    this.find('.cfti_addgroupbutton').remove();
	    this.find('.cfti_delgroupbutton').remove();
	}

        return this;
    };
}(jQuery));
